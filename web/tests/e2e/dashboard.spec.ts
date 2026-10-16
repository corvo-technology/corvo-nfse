import { expect, test, type Page } from "@playwright/test";
import { company, invoice, session } from "../fixtures";

async function mockApi(page: Page, options: { authenticated?: boolean; invalidCode?: boolean; failSessionOnce?: boolean; permissions?: string[] } = {}) {
  let authenticated = options.authenticated ?? false;
  let verified = false; let verificationCount = 0; let sessionFailureUsed = false;
  const mutations: { path: string; csrf: string | undefined; body: unknown }[] = [];
  await page.route("**/api/proxy/v1/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace("/api/proxy/v1", ""); const method = request.method();
    const headers = request.headers(); const body = method === "GET" ? undefined : request.postData();
    expect(headers.authorization).toBeUndefined(); expect(headers["x-api-key"]).toBeUndefined();
    if (method !== "GET") mutations.push({ path, csrf: headers["x-csrf-token"], body: headers["content-type"]?.includes("application/json") && body ? JSON.parse(body) : body });
    const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => route.fulfill({ status, contentType: "application/json", headers: extra, body: JSON.stringify(value) });
    if (path === "/auth/session") {
      if (verified && options.failSessionOnce && !sessionFailureUsed) { sessionFailureUsed = true; return json({ message: "temporarily unavailable" }, 502); }
      return authenticated ? json({ data: options.permissions ? { ...session, permissions: options.permissions } : session }) : json({ message: "No session" }, 401);
    }
    if (path === "/auth/magic-link/request") return json({ data: { challengeId: "challenge-1", expiresAt: "2099-01-01T00:00:00Z", resendAvailableAt: new Date(Date.now() + 60_000).toISOString() } });
    if (path === "/auth/magic-link/verify") {
      verificationCount++; if (options.invalidCode) return json({ message: "OTP_INVALID_OR_EXPIRED" }, 401);
      authenticated = true; verified = true;
      return json({ data: { csrfToken: "test-csrf", isNewUser: false, expiresAt: session.expiresAt } }, 200, { "Set-Cookie": "gf_session_dev=e2e-session; Path=/; HttpOnly; SameSite=Lax" });
    }
    if (path === "/auth/session/logout") { authenticated = false; return route.fulfill({ status: 204, headers: { "Set-Cookie": "gf_session_dev=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" } }); }
    if (path === "/companies") return json({ data: method === "POST" ? company : [company] }, method === "POST" ? 201 : 200);
    if (path === "/companies/company-1") return json({ data: company });
    if (path === "/companies/company-1/certificates") return json(method === "POST" ? { id: "cert-1", companyId: company.id, status: "active", expiresAt: session.expiresAt, uploadedAt: company.createdAt } : [], method === "POST" ? 201 : 200);
    if (path === "/invoices") return json(method === "POST" ? invoice : [invoice], method === "POST" ? 201 : 200);
    if (path === "/invoices/invoice-1") return json(invoice);
    if (path === "/invoices/invoice-1/events") return json([{ id: "event-1", invoiceId: "invoice-1", fromStatus: "processing", toStatus: "authorized", createdAt: invoice.createdAt, reason: null }]);
    if (path === "/invoices/invoice-1/pdf") return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4 test" });
    if (path === "/invoices/invoice-1/xml") return route.fulfill({ contentType: "application/xml", body: "<nfse/>" });
    if (path === "/billing/plan") return json({ data: { plan: { slug: "free", name: "Free", monthly_price_cents: 0 }, usage: { credits_used: 1, credits_reserved: 0, credits_remaining: 99, monthly_allowance: 100, daily_usage: 1, daily_limit: 10, active_companies: 1, max_active_companies: 1, period_start: "2026-10-01T00:00:00Z", period_end: "2026-11-01T00:00:00Z" } } });
    if (path === "/plans") return json({ data: [{ slug: "free", name: "Free", monthlyAllowance: 100, basePriceCents: 0, perCreditOverageCents: 10, monthlyTotalCents: 0, annualTotalCents: 0, currency: "BRL" }] });
    return json({ message: `Unexpected route: ${path}` }, 404);
  });
  return { mutations, verificationCount: () => verificationCount };
}
async function enterCode(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "you@company.com" }).fill("person@example.com");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  await page.getByRole("textbox", { name: "Enter the code" }).fill("123456");
}
test("cookie login, single verification, reload and CSRF logout without session storage", async ({ page, context }) => {
  const api = await mockApi(page); await enterCode(page);
  await expect(page).toHaveURL(/\/app$/); expect(api.verificationCount()).toBe(1);
  expect(api.mutations.find((item) => item.path.endsWith("/verify"))?.body).toEqual({ email: "person@example.com", challengeId: "challenge-1", code: "123456" });
  const cookie = (await context.cookies()).find((item) => item.name === "gf_session_dev"); expect(cookie?.httpOnly).toBe(true);
  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })); expect(storage.local).toEqual({}); expect(storage.session).toEqual({}); expect(storage.cookie).not.toContain("gf_session_dev");
  await page.reload(); await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByText("Common.skipToContent")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  expect(api.mutations.find((item) => item.path.endsWith("/logout"))?.csrf).toBe("test-csrf"); expect((await context.cookies()).some((item) => item.name === "gf_session_dev")).toBe(false);
});
test("invalid code stays in login and does not duplicate verification", async ({ page }) => {
  const api = await mockApi(page, { invalidCode: true }); await enterCode(page);
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page).toHaveURL(/\/login$/); expect(api.verificationCount()).toBe(1);
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
});
test("a failed post-login session can be retried without reusing the OTP", async ({ page }) => {
  const api = await mockApi(page, { failSessionOnce: true }); await enterCode(page);
  await page.getByRole("button", { name: "Load my session" }).click(); await expect(page).toHaveURL(/\/app$/); expect(api.verificationCount()).toBe(1);
});
test("invoice detail renders events and downloads a PDF", async ({ page }) => {
  await mockApi(page, { authenticated: true }); await page.goto("/app/invoices/invoice-1");
  await expect(page.getByText("Customer", { exact: true })).toBeVisible(); await expect(page.getByText("Consulting", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download PDF" }).click(); expect((await download).suggestedFilename()).toContain("invoice-1.pdf");
});
test("developer without settings permission cannot open memberships", async ({ page }) => {
  await mockApi(page, { authenticated: true, permissions: ["nfse.invoices.view"] }); await page.goto("/app/members");
  await expect(page.getByRole("alert")).toHaveText("You do not have permission to access this page.");
  await expect(page.locator('a[href="/app/members"]')).toHaveCount(0);
});
