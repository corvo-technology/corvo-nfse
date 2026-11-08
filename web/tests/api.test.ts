import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCompanyLimitError, schedules, imports, request, auth, certificates, companies, invoices, billing, webhooks, members, ApiError, setCsrfToken, getCsrfToken, onUnauthorized, unwrap, toPage, credits, collectAll } from "@/lib/api";
import { fieldIssues, mapIssues } from "@/lib/api-errors";
import { session, company, invoice } from "./fixtures";
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
beforeEach(() => { setCsrfToken(null); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe("cookie transport", () => {
  it("uses one /v1, cookie credentials, no cache or dashboard Bearer/API keys", async () => {
    fetchMock.mockResolvedValue(reply({ data: session }));
    await request("/auth/session", { credentials: "omit", cache: "force-cache", headers: new Headers({ Authorization: "Bearer legacy", "x-api-key": "legacy-key" }) });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/auth/session"); expect(options?.credentials).toBe("include"); expect(options?.cache).toBe("no-store");
    const headers = new Headers(options?.headers); expect(headers.has("Authorization")).toBe(false); expect(headers.has("x-api-key")).toBe(false);
  });
  it("sends challengeId to verify and does not fetch a session before public login", async () => {
    fetchMock.mockResolvedValue(reply({ data: { csrfToken: "issued" } }));
    await auth.magicLinkVerify("person@example.com", "challenge-1", "123456");
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: "person@example.com", challengeId: "challenge-1", code: "123456" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("x-csrf-token")).toBe(false);
  });
  it("recovers CSRF once for concurrent authenticated mutations and handles 204", async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/session") ? reply({ data: session }) : reply(null, 204));
    await Promise.all([auth.logout(), auth.logout()]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/session"))).toHaveLength(1);
    expect(fetchMock.mock.calls.slice(1).every(([, init]) => new Headers(init?.headers).get("x-csrf-token") === "test-csrf")).toBe(true);
  });
  it("lets the browser define multipart Content-Type", async () => {
    setCsrfToken("test-csrf"); fetchMock.mockResolvedValue(reply({ data: { id: "cert-1" } }, 201));
    const data = new FormData(); data.set("password", "certificate-password"); data.set("file", new Blob(["test"]), "cert.p12");
    await certificates.create("company-1", data);
    const init = fetchMock.mock.calls[0][1]; expect(init?.body).toBe(data); expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });
  it("invalidates only protected 401 responses; public invalid OTP leaves auth state alone", async () => {
    const listener = vi.fn(); const unsubscribe = onUnauthorized(listener);
    fetchMock.mockImplementation(async () => reply({ message: "OTP_INVALID_OR_EXPIRED" }, 401));
    await expect(auth.magicLinkVerify("person@example.com", "challenge", "123456")).rejects.toMatchObject({ status: 401 }); expect(listener).not.toHaveBeenCalled();
    await expect(auth.session()).rejects.toMatchObject({ status: 401 }); expect(listener).toHaveBeenCalledOnce(); expect(getCsrfToken()).toBeNull(); unsubscribe();
  });
  it("ignores a late 401 from a previous session", async () => {
    let resolve!: (value: Response) => void; fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    setCsrfToken("old"); const pending = auth.session(); setCsrfToken("new"); resolve(reply({ message: "Expired" }, 401));
    await expect(pending).rejects.toMatchObject({ status: 401 }); expect(getCsrfToken()).toBe("new");
  });
  it("preserves Retry-After and new ERROR_* bodies without retrying mutations", async () => {
    fetchMock.mockResolvedValue(reply({ statusCode: 429, code: "ERROR_RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded", requestId: "req-1" }, 429, { "Retry-After": "17" }));
    await expect(auth.magicLinkRequest("bad")).rejects.toMatchObject({ status: 429, code: "ERROR_RATE_LIMIT_EXCEEDED", retryAfterSeconds: 17, requestId: "req-1", message: "Rate limit exceeded" }); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("maps validation details and falls back on missing bodies", async () => {
    fetchMock.mockResolvedValueOnce(reply({ statusCode: 400, code: "ERROR_VALIDATION", message: "Request validation failed", details: [{ field: "customer.taxId", code: "ERROR_INVALID_TAX_ID", message: "Invalid tax ID" }], requestId: "req-2" }, 400)).mockResolvedValueOnce(reply(null, 500));
    await expect(auth.me()).rejects.toMatchObject({ status: 400, code: "ERROR_VALIDATION", details: [{ field: "customer.taxId" }] });
    await expect(auth.me()).rejects.toMatchObject({ status: 500, message: "Request failed (500)", code: undefined });
  });
  it("checks errors before returning PDF/XML blobs", async () => {
    fetchMock.mockResolvedValueOnce(new Response("pdf bytes", { headers: { "Content-Type": "application/pdf" } })).mockResolvedValueOnce(reply({ message: "Unavailable" }, 404));
    expect(await (await invoices.pdf("invoice-1")).text()).toBe("pdf bytes"); await expect(invoices.xml("invoice-1")).rejects.toBeInstanceOf(ApiError);
  });
});
describe("endpoint-specific contracts", () => {
  const page = (rows: unknown[], hasMore = false, nextCursor: string | null = null) => ({ data: rows, pagination: { limit: 50, hasMore, nextCursor } });
  it("adapts enveloped pages: company addresses, flat invoices and events, server cursors", async () => {
    fetchMock.mockResolvedValueOnce(reply(page([company], true, "c1"))).mockResolvedValueOnce(reply(page([invoice], true, "i1"))).mockResolvedValueOnce(reply(page([{ id: "event-1", invoiceId: "invoice-1", fromStatus: "processing", toStatus: "authorized", createdAt: "2026-10-09T12:00:00.000Z", reason: null }])));
    const c = await companies.list({ limit: 50 }); expect(c.items[0].address.city).toBe("São Paulo"); expect(c).toMatchObject({ hasMore: true, nextCursor: "c1" });
    const result = await invoices.list({ limit: 1000, cursor: "prev", status: "authorized" });
    expect(result.items[0]).toMatchObject({ customerName: "Customer", serviceDescription: "Consulting", nfseNumber: 123 }); expect(result).toMatchObject({ hasMore: true, nextCursor: "i1" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("limit=1000"); expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=prev"); expect(String(fetchMock.mock.calls[1][0])).not.toMatch(/offset|page=/);
    expect((await invoices.events("invoice-1")).items[0]).toMatchObject({ from: "processing", to: "authorized", at: invoice.createdAt });
  });
  it("unwraps single invoices and companies from data", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: invoice })).mockResolvedValueOnce(reply({ data: company }, 201));
    expect((await invoices.get("invoice-1")).customerName).toBe("Customer"); expect((await companies.get("company-1")).address.city).toBe("São Paulo");
  });
  it("adapts nested snake-case billing, subscription and paged lists", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: { plan: { slug: "free", name: "Free", monthly_price_cents: 0 }, subscription: { status: "active", paid_until: "2026-11-01T00:00:00Z", cancel_at_period_end: false, scheduled_plan: "equipe", blocked: false }, usage: { avulso_balance: 3, credits_used: 2, credits_reserved: 1, credits_remaining: 97, monthly_allowance: 100, daily_usage: 2, daily_limit: 10, active_companies: 1, max_active_companies: 1, period_start: "2026-10-01T00:00:00Z" } } })).mockResolvedValueOnce(reply(page([{ id: "wh-1", events: ["nfse.invoice.authorized"] }]))).mockResolvedValueOnce(reply(page([{ id: "user-1", email: "person@example.com" }])));
    expect(await billing.plan()).toMatchObject({ slug: "free", subscription: { status: "active", scheduledPlan: "equipe" }, usage: { creditsUsed: 2, avulsoBalance: 3, periodStart: "2026-10-01T00:00:00Z" } });
    expect((await webhooks.list()).items[0].id).toBe("wh-1"); expect((await members.list()).items[0].id).toBe("user-1");
  });
  it("sends the cursor (not offset) for deliveries and credit history and unwraps balance", async () => {
    fetchMock.mockResolvedValueOnce(reply(page([{ id: "d1" }], true, "dc"))).mockResolvedValueOnce(reply(page([{ id: "t1" }]))).mockResolvedValueOnce(reply({ data: { tenantId: "t", balance: 5, hardLimit: null } }));
    const d = await webhooks.deliveries({ hours: 24, limit: 50, environment: "live", cursor: "abc" }); expect(d.nextCursor).toBe("dc");
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=abc"); expect(String(fetchMock.mock.calls[0][0])).not.toContain("offset");
    expect((await credits.history({ limit: 10 })).items[0].id).toBe("t1"); expect((await credits.balance()).balance).toBe(5);
  });
  it("collectAll follows nextCursor until the end", async () => {
    fetchMock.mockResolvedValueOnce(reply(page([{ id: "a" }], true, "n1"))).mockResolvedValueOnce(reply(page([{ id: "b" }])));
    expect((await collectAll((cursor) => members.list({ cursor, limit: 1 }))).map((m) => m.id)).toEqual(["a", "b"]); expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=n1");
  });
  it("checkout sends plan_slug with an Idempotency-Key; portal and plan change adapt snake_case", async () => {
    setCsrfToken("csrf");
    fetchMock.mockResolvedValueOnce(reply({ data: { session_id: "cs_1", url: "https://stripe.test/pay" } }, 201)).mockResolvedValueOnce(reply({ data: { url: "https://stripe.test/portal" } })).mockResolvedValueOnce(reply({ data: { scheduled_plan: "equipe", effective_at: "2026-11-01T00:00:00Z" } })).mockResolvedValueOnce(reply({ data: { session_id: "cs_1", status: "complete", payment_status: "paid", activated: true } }));
    expect(await billing.checkout("solo", "key-1")).toEqual({ sessionId: "cs_1", url: "https://stripe.test/pay" });
    const init = fetchMock.mock.calls[0][1]; expect(JSON.parse(String(init?.body))).toEqual({ plan_slug: "solo" }); expect(new Headers(init?.headers).get("idempotency-key")).toBe("key-1");
    expect((await billing.portal()).url).toBe("https://stripe.test/portal");
    expect(await billing.changePlan("equipe", "upgrade")).toEqual({ scheduledPlan: "equipe", effectiveAt: "2026-11-01T00:00:00Z" }); expect(String(fetchMock.mock.calls[2][0])).toContain("/billing/upgrade");
    expect(await billing.checkoutStatus("cs_1")).toMatchObject({ activated: true, paymentStatus: "paid" });
  });
  it("exposes 409 billing conflicts and 422 validation details to forms", async () => {
    fetchMock.mockResolvedValueOnce(reply({ statusCode: 422, code: "ERROR_VALIDATION", message: "Request validation failed", details: [{ field: "customer.taxId", code: "ERROR_INVALID_TAX_ID", message: "Invalid tax ID" }], requestId: "r" }, 422));
    const error = await invoices.get("x").catch((cause) => cause);
    expect(fieldIssues(error)).toEqual([{ field: "customer.taxId", code: "ERROR_INVALID_TAX_ID", message: "Invalid tax ID" }]);
    expect(mapIssues(error, { "customer.taxId": "customerTaxId" }, (_code, fallback) => fallback)).toEqual({ customerTaxId: "Invalid tax ID" });
  });
});
describe("envelope helpers", () => {
  it("unwraps data and rejects missing envelopes", async () => {
    expect(unwrap<{ id: string }>({ data: { id: "c1" } }).id).toBe("c1");
    expect(() => unwrap(null)).toThrow(ApiError);
    expect(() => unwrap({} as never)).toThrow(ApiError);
  });
  it("builds pages from data+pagination and tolerates missing pagination", () => {
    expect(toPage({ data: [1, 2], pagination: { limit: 50, hasMore: true, nextCursor: "cur" } })).toEqual({ items: [1, 2], hasMore: true, nextCursor: "cur" });
    expect(toPage({ data: [] })).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(toPage({ data: [{ id: "last" }], pagination: { hasMore: false, nextCursor: null } }).hasMore).toBe(false);
  });
});

describe("company fiscal API contracts", () => {
  it("loads fiscal history and dated service profiles with the normal cookie transport", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: [] })).mockResolvedValueOnce(reply({ data: [] }));
    await companies.fiscalProfiles("company/1");
    await companies.serviceTaxProfiles("company/1", "2026-10-15");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/companies/company%2F1/fiscal-profile");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/proxy/v1/companies/company%2F1/service-tax-profiles?date=2026-10-15");
  });
  it("uses explicit scoped approvals and unwraps the saved state", async () => {
    setCsrfToken("test-csrf");
    fetchMock.mockResolvedValueOnce(reply({ data: { reviewStatus: "approved" } })).mockResolvedValueOnce(reply({ data: { reviewStatus: "approved" } }));
    expect(await companies.approveFiscalProfile("company", "profile/1")).toMatchObject({ reviewStatus: "approved" });
    expect(await companies.approveServiceTaxProfile("company", "service/1")).toMatchObject({ reviewStatus: "approved" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/companies/company/fiscal-profile/profile%2F1/approve");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/companies/company/service-tax-profiles/service%2F1/approve");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST" && new Headers(init.headers).get("x-csrf-token") === "test-csrf")).toBe(true);
  });
});

describe("adaptInvoice", () => {
  const props = { id: "i", serviceSnapshot: { description: "Corte", code: "060101", municipalityCode: "3550308" } } as never;

  it("keeps the customer name and tax id when the invoice has a tomador", async () => {
    const { adaptInvoice } = await import("@/lib/api");
    const invoice = adaptInvoice({ ...(props as object), customerSnapshot: { name: "Ana", taxId: "52998224725" } } as never);
    expect(invoice.customerName).toBe("Ana");
    expect(invoice.customerTaxId).toBe("52998224725");
  });

  it("does not throw for anonymous consumer invoices (no customer snapshot)", async () => {
    const { adaptInvoice } = await import("@/lib/api");
    const invoice = adaptInvoice({ ...(props as object), customerSnapshot: null } as never);
    expect(invoice.customerName).toBe("");
    expect(invoice.customerTaxId).toBe("");
    expect(invoice.serviceDescription).toBe("Corte");
  });
});

describe("billing.purchase", () => {
  it("posts the unified checkout body with an Idempotency-Key and returns the provider result", async () => {
    setCsrfToken("csrf");
    fetchMock.mockResolvedValueOnce(reply({ data: { method: "pix", brCode: "BR", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/p", expiresAt: null } })).mockResolvedValueOnce(reply({ data: { method: "card", url: "https://stripe.test/s" } }));
    const pix = await billing.purchase({ kind: "avulso", units: 10, method: "pix" }, "key-9");
    expect(pix).toMatchObject({ method: "pix", brCode: "BR" });
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "avulso", units: 10, method: "pix" });
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("key-9");
    await billing.purchase({ kind: "plan", planSlug: "solo", cycle: "annual", method: "card" }, "key-10");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ kind: "plan", plan_slug: "solo", cycle: "annual", method: "card" });
  });
});

describe("billing.cancelPix", () => {
  it("posts to the Pix cancel endpoint and the plan reports an active Pix subscription", async () => {
    setCsrfToken("csrf");
    fetchMock.mockResolvedValueOnce(reply({ data: { cancelled: true } })).mockResolvedValueOnce(reply({ data: { plan: { slug: "solo", name: "Solo", monthly_price_cents: 5990 }, subscription: { status: "active", paid_until: "2026-12-01T00:00:00Z", cancel_at_period_end: false, scheduled_plan: null, blocked: false, pix_subscription: { status: "pending", planSlug: "equipe", brCode: "000201EMV", paymentLinkUrl: "https://woovi.test/p" } }, usage: { credits_used: 1, credits_reserved: 0, credits_remaining: 99, monthly_allowance: 100, daily_usage: 0, daily_limit: null, active_companies: 1, max_active_companies: 999999 } } }));
    await billing.cancelPix();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/billing/pix/cancel");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect((await billing.plan()).subscription.pixSubscription).toEqual({ status: "pending", planSlug: "equipe", brCode: "000201EMV", paymentLinkUrl: "https://woovi.test/p" });
  });
});

describe("isCompanyLimitError", () => {
  it("recognises the API's company limit refusal, and nothing else", () => {
    expect(isCompanyLimitError(new ApiError(422, "Company limit exceeded"))).toBe(true);
    expect(isCompanyLimitError(new ApiError(422, "company_limit_exceeded"))).toBe(true);
    expect(isCompanyLimitError(new ApiError(422, "Invalid CNPJ"))).toBe(false);
    expect(isCompanyLimitError(new ApiError(500, "Company limit exceeded"))).toBe(false);
    expect(isCompanyLimitError(new Error("Company limit exceeded"))).toBe(false);
    expect(isCompanyLimitError(null)).toBe(false);
  });
});

describe("schedules", () => {
  beforeEach(() => setCsrfToken("csrf"));
  const wire = { id: "s1", kind: "recurring", frequency: "WEEKLY", status: "paused", pause_reason: "failures", company_id: "c1", anchor_on: "2026-11-09", next_run_on: null, ends_on: "2027-01-31", attempts: 3, last_run_on: "2026-11-11", invoice: { amount: 100 }, created_at: "2026-11-06T15:00:00.000Z" };

  it("lists with the cursor and adapts snake_case to the app's shape", async () => {
    fetchMock.mockResolvedValue(reply({ data: [wire], pagination: { limit: 50, hasMore: true, nextCursor: "50" } }));
    const page = await schedules.list({ cursor: "0" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/schedules?cursor=0");
    expect(page).toMatchObject({ hasMore: true, nextCursor: "50" });
    expect(page.items[0]).toEqual({ id: "s1", kind: "recurring", frequency: "WEEKLY", status: "paused", pauseReason: "failures", companyId: "c1", anchorOn: "2026-11-09", nextRunOn: null, endsOn: "2027-01-31", attempts: 3, lastRunOn: "2026-11-11", invoice: { amount: 100 }, createdAt: "2026-11-06T15:00:00.000Z" });
  });

  it("pause, resume and cancel POST to the action and return the schedule", async () => {
    fetchMock.mockImplementation(async () => reply({ data: { ...wire, status: "active" } }));
    expect((await schedules.resume("s1")).status).toBe("active");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/schedules/s1/resume");
    await schedules.pause("s1"); await schedules.cancel("s1");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/proxy/v1/schedules/s1/resume", "/api/proxy/v1/schedules/s1/pause", "/api/proxy/v1/schedules/s1/cancel"]);
  });

  it("update PATCHes only what is sent", async () => {
    fetchMock.mockResolvedValue(reply({ data: wire }));
    await schedules.update("s1", { endsOn: null, frequency: "MONTHLY" });
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ endsOn: null, frequency: "MONTHLY" });
  });

  it("runs adapts the log", async () => {
    fetchMock.mockResolvedValue(reply({ data: [{ id: "r1", occurrence_on: "2026-11-07", ran_on: "2026-11-09", attempt: 1, outcome: "failed", invoice_id: null, error_code: "ERROR_QUOTA_EXCEEDED", error_message: "no credits", created_at: "2026-11-09T12:00:00.000Z" }], pagination: { hasMore: false, nextCursor: null } }));
    const page = await schedules.runs("s1");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/schedules/s1/runs");
    expect(page.items[0]).toEqual({ id: "r1", occurrenceOn: "2026-11-07", ranOn: "2026-11-09", attempt: 1, outcome: "failed", invoiceId: null, errorCode: "ERROR_QUOTA_EXCEEDED", errorMessage: "no credits", createdAt: "2026-11-09T12:00:00.000Z" });
  });

  it("createSchedule posts the emission with its schedule options and returns the schedule", async () => {
    fetchMock.mockResolvedValue(reply({ data: wire }, 202));
    const created = await schedules.create({ companyId: "c1", amount: 100, competenceDate: "2026-11-09", options: { type: "RECURRING", recurrence: { frequency: "WEEKLY" } } });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/invoices");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).options).toEqual({ type: "RECURRING", recurrence: { frequency: "WEEKLY" } });
    expect(created.id).toBe("s1");
  });
});

describe("imports", () => {
  const importWire = { id: "i1", status: "ready", file_name: "n.csv", company_id: null, error_code: null, emit_started_at: null, emit_finished_at: null, created_at: "2026-11-07T10:00:00.000Z", counters: { total: 3, valid: 2, invalid: 1, accepted: 0, authorized: 0, awaiting_credits: 5, valid_amount: 1600.4, awaiting_amount: 200, failed: 1, pending: 2, authorized_amount: 350.5, pending_amount: 1249.9, failed_amount: 99.9 }, rows_expected: 300, unknown_columns: ["obs", "cor"] };
  const rowWire = { line: 4, data: { amount: 10 }, status: "invalid", error_code: "ERROR_VALIDATION", error_message: "bad", invoice_id: null };
  it("sends the file as multipart with the optional company, and reads the answer", async () => {
    setCsrfToken("csrf");
    fetchMock.mockResolvedValue(reply({ data: { id: "i1", status: "processing", duplicate_of: "old" } }, 202));
    const file = new File(["valor\n1\n"], "n.csv", { type: "text/csv" });
    expect(await imports.start(file, "c1")).toEqual({ id: "i1", status: "processing", duplicateOf: "old" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/proxy/v1/imports");
    const body = options?.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File); expect(body.get("companyId")).toBe("c1");
    fetchMock.mockResolvedValue(reply({ data: { id: "i2", status: "processing", duplicate_of: null } }, 202));
    await imports.start(file); expect((fetchMock.mock.calls[1][1]?.body as FormData).has("companyId")).toBe(false);
  });
  it("reads an import and its rows page by page, in camelCase", async () => {
    fetchMock.mockResolvedValue(reply({ data: importWire }));
    expect(await imports.get("i1")).toEqual({ id: "i1", status: "ready", fileName: "n.csv", companyId: null, errorCode: null, rowsExpected: 300, unknownColumns: ["obs", "cor"], emitStartedAt: null, emitFinishedAt: null, createdAt: "2026-11-07T10:00:00.000Z", counters: { total: 3, valid: 2, invalid: 1, accepted: 0, authorized: 0, awaitingCredits: 5, validAmount: 1600.4, awaitingAmount: 200, failed: 1, pending: 2, authorizedAmount: 350.5, pendingAmount: 1249.9, failedAmount: 99.9 } });
    fetchMock.mockResolvedValue(reply({ data: [rowWire], pagination: { hasMore: true, nextCursor: "4" } }));
    const page = await imports.rows("i1", { status: "invalid", cursor: "2", limit: 50 });
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/proxy/v1/imports/i1/rows?status=invalid&cursor=2&limit=50");
    expect(page).toEqual({ items: [{ line: 4, data: { amount: 10 }, status: "invalid", errorCode: "ERROR_VALIDATION", errorMessage: "bad", invoiceId: null }], hasMore: true, nextCursor: "4" });
  });
  it("reads the amounts of an older API that does not send them as zero", async () => {
    const older = Object.fromEntries(Object.entries(importWire.counters).filter(([key]) => !key.endsWith("_amount") || key === "valid_amount" || key === "awaiting_amount"));
    fetchMock.mockResolvedValue(reply({ data: { ...importWire, counters: older } }));
    expect((await imports.get("i1")).counters).toMatchObject({ authorizedAmount: 0, pendingAmount: 0, failedAmount: 0 });
  });
  it("lists the recent imports, newest first, with their counters", async () => {
    fetchMock.mockResolvedValue(reply({ data: [importWire, { ...importWire, id: "i2" }] }));
    const list = await imports.list(5);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/imports?limit=5");
    expect(list.map((job) => job.id)).toEqual(["i1", "i2"]);
    expect(list[0].counters.awaitingCredits).toBe(5);
  });
  it("corrects a row, emits, discards and downloads the csv files", async () => {
    setCsrfToken("csrf");
    fetchMock.mockResolvedValue(reply({ data: rowWire }));
    const row = await imports.updateRow("i1", 4, { amount: 10 });
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH"); expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ item: { amount: 10 } }); expect(row.errorCode).toBe("ERROR_VALIDATION");
    fetchMock.mockResolvedValue(reply({ data: { ...importWire, status: "emitting" } }, 202));
    expect((await imports.emit("i1")).status).toBe("emitting"); expect(String(fetchMock.mock.calls[1][0])).toBe("/api/proxy/v1/imports/i1/emit");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await imports.discard("i1"); expect(fetchMock.mock.calls[2][1]?.method).toBe("DELETE");
    fetchMock.mockImplementation(() => Promise.resolve(new Response("a;b\n", { headers: { "Content-Type": "text/csv" } })));
    expect(await (await imports.errorsCsv("i1")).text()).toBe("a;b\n"); expect(String(fetchMock.mock.calls[3][0])).toBe("/api/proxy/v1/imports/i1/errors.csv");
    expect(await (await imports.template()).text()).toBe("a;b\n"); expect(String(fetchMock.mock.calls[4][0])).toBe("/api/proxy/v1/imports/template");
  });
});

describe("manual review in batches", () => {
  it("sends the invoices in chunks of 100 and joins the results", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    fetchMock.mockImplementation(async (url, options) => {
      if (!String(url).includes("/invoices/review")) return reply({ data: { csrfToken: "issued" } });
      const body = JSON.parse(String(options?.body)) as { invoiceIds: string[] };
      return reply({ data: { results: body.invoiceIds.map((id) => ({ id, outcome: "accepted" })) } });
    });
    const results = await invoices.review("retry", ids);
    const reviews = fetchMock.mock.calls.filter(([url]) => String(url).includes("/invoices/review"));
    expect(reviews).toHaveLength(2);
    expect(JSON.parse(String(reviews[0][1]?.body)).invoiceIds).toHaveLength(100);
    expect(JSON.parse(String(reviews[1][1]?.body))).toEqual({ action: "retry", invoiceIds: ids.slice(100) });
    expect(results).toHaveLength(150);
  });
});
