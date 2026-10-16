import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, auth, certificates, companies, invoices, billing, webhooks, members, ApiError, setCsrfToken, getCsrfToken, onUnauthorized, unwrap, toPage, credits, collectAll } from "@/lib/api";
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
  it("adapts enveloped pages: company addresses, invoice props, event props, server cursors", async () => {
    fetchMock.mockResolvedValueOnce(reply(page([company], true, "c1"))).mockResolvedValueOnce(reply(page([invoice], true, "i1"))).mockResolvedValueOnce(reply(page([{ props: { id: "event-1", invoiceId: "invoice-1", fromStatus: "processing", toStatus: "authorized", createdAt: "2026-10-09T12:00:00.000Z", reason: null } }])));
    const c = await companies.list({ limit: 50 }); expect(c.items[0].address.city).toBe("São Paulo"); expect(c).toMatchObject({ hasMore: true, nextCursor: "c1" });
    const result = await invoices.list({ limit: 1000, cursor: "prev", status: "authorized" });
    expect(result.items[0]).toMatchObject({ customerName: "Customer", serviceDescription: "Consulting", nfseNumber: 123 }); expect(result).toMatchObject({ hasMore: true, nextCursor: "i1" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("limit=1000"); expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=prev"); expect(String(fetchMock.mock.calls[1][0])).not.toMatch(/offset|page=/);
    expect((await invoices.events("invoice-1")).items[0]).toMatchObject({ from: "processing", to: "authorized", at: invoice.props.createdAt });
  });
  it("unwraps single invoices and companies from data", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: invoice })).mockResolvedValueOnce(reply({ data: company }, 201));
    expect((await invoices.get("invoice-1")).customerName).toBe("Customer"); expect((await companies.get("company-1")).address.city).toBe("São Paulo");
  });
  it("adapts nested snake-case billing, subscription and paged lists", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: { plan: { slug: "free", name: "Free", monthly_price_cents: 0 }, subscription: { status: "active", paid_until: "2026-11-01T00:00:00Z", cancel_at_period_end: false, scheduled_plan: "growth", blocked: false }, usage: { overage_units: 3, overage_amount_cents: 90, credits_used: 2, credits_reserved: 1, credits_remaining: 97, monthly_allowance: 100, daily_usage: 2, daily_limit: 10, active_companies: 1, max_active_companies: 1, period_start: "2026-10-01T00:00:00Z" } } })).mockResolvedValueOnce(reply(page([{ id: "wh-1", events: ["nfse.invoice.authorized"] }]))).mockResolvedValueOnce(reply(page([{ id: "user-1", email: "person@example.com" }])));
    expect(await billing.plan()).toMatchObject({ slug: "free", subscription: { status: "active", scheduledPlan: "growth" }, usage: { creditsUsed: 2, overageUnits: 3, overageAmountCents: 90, periodStart: "2026-10-01T00:00:00Z" } });
    expect((await webhooks.list()).items[0].id).toBe("wh-1"); expect((await members.list()).items[0].id).toBe("user-1");
  });
  it("sends the cursor (not offset) for deliveries and credit history and unwraps balance", async () => {
    fetchMock.mockResolvedValueOnce(reply(page([{ id: "d1" }], true, "dc"))).mockResolvedValueOnce(reply(page([{ id: "t1" }]))).mockResolvedValueOnce(reply({ data: { tenantId: "t", balance: 5, overageUnits: 0, overageAmountCents: 0, hardLimit: null } }));
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
    fetchMock.mockResolvedValueOnce(reply({ data: { session_id: "cs_1", url: "https://stripe.test/pay" } }, 201)).mockResolvedValueOnce(reply({ data: { url: "https://stripe.test/portal" } })).mockResolvedValueOnce(reply({ data: { scheduled_plan: "growth", effective_at: "2026-11-01T00:00:00Z" } })).mockResolvedValueOnce(reply({ data: { session_id: "cs_1", status: "complete", payment_status: "paid", activated: true } }));
    expect(await billing.checkout("developer", "key-1")).toEqual({ sessionId: "cs_1", url: "https://stripe.test/pay" });
    const init = fetchMock.mock.calls[0][1]; expect(JSON.parse(String(init?.body))).toEqual({ plan_slug: "developer" }); expect(new Headers(init?.headers).get("idempotency-key")).toBe("key-1");
    expect((await billing.portal()).url).toBe("https://stripe.test/portal");
    expect(await billing.changePlan("growth", "upgrade")).toEqual({ scheduledPlan: "growth", effectiveAt: "2026-11-01T00:00:00Z" }); expect(String(fetchMock.mock.calls[2][0])).toContain("/billing/upgrade");
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
