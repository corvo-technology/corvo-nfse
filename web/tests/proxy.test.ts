import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, PATCH, DELETE } from "@/app/api/proxy/[...path]/route";
const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("forwards original origin, CSRF and only recognized cookies, with no Bearer/API key", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  const response = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/session/logout", { method: "POST", headers: { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "x-csrf-token": "csrf", Cookie: "analytics=ignored; gf_session_dev=session; other=ignored", Authorization: "Bearer legacy", "x-api-key": "legacy" } }), context("auth/session/logout"));
  expect(response.status).toBe(204); expect(await response.text()).toBe("");
  const [target, options] = fetchMock.mock.calls[0]; expect(String(target)).toBe("http://localhost:3000/v1/auth/session/logout");
  const headers = new Headers(options?.headers); expect(headers.get("Cookie")).toBe("gf_session_dev=session"); expect(headers.get("Origin")).toBe("http://localhost:4000"); expect(headers.get("x-csrf-token")).toBe("csrf"); expect(headers.has("Authorization")).toBe(false); expect(headers.has("x-api-key")).toBe(false);
});
it("rejects missing/foreign origins and cross-site mutations before contacting the API", async () => {
  const origins: Record<string, string>[] = [{}, { origin: "http://evil.example" }, { origin: "http://localhost:4000", "sec-fetch-site": "cross-site" }];
  for (const headers of origins) {
    const response = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/magic-link/request", { method: "POST", headers }), context("auth/magic-link/request")); expect(response.status).toBe(403);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves login and logout Set-Cookie attributes, Retry-After and binary downloads", async () => {
  const headers = new Headers({ "Content-Type": "application/pdf", "Retry-After": "12", "Content-Disposition": "attachment; filename=note.pdf" });
  headers.append("Set-Cookie", "gf_session_dev=opaque; HttpOnly; SameSite=Lax; Path=/"); headers.append("Set-Cookie", "other=ignore; Path=/");
  fetchMock.mockResolvedValue(new Response("pdf-data", { headers }));
  const response = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/id/pdf"), context("invoices/id/pdf"));
  expect(await response.text()).toBe("pdf-data"); expect(response.headers.getSetCookie()).toEqual(["gf_session_dev=opaque; HttpOnly; SameSite=Lax; Path=/"]); expect(response.headers.get("retry-after")).toBe("12"); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("content-disposition")).toContain("note.pdf");
});
it("rejects traversal, arbitrary URLs, pending OAuth/payment and legacy routes", async () => {
  for (const route of ["../auth/session", "https:/evil.example", "auth/oauth/google/authorize", "auth/logout", "billing/unknown", "credits/purchase/confirm"]) {
    const response = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/test", { method: "POST", headers: { origin: "http://localhost:4000" } }), context(route)); expect([400, 404]).toContain(response.status);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("streams multipart unchanged and rejects oversized certificate uploads", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));
  const headers = { Origin: "http://localhost:4000", "Content-Type": "multipart/form-data; boundary=test" };
  const data = "--test\r\nfile-bytes\r\n--test--";
  const response = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/companies/id/certificates", { method: "POST", headers, body: data }), context("companies/id/certificates")); expect(response.status).toBe(201); expect(new TextDecoder().decode(fetchMock.mock.calls[0][1]?.body as Uint8Array)).toBe(data);
  const oversized = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/companies/id/certificates", { method: "POST", headers, body: "x".repeat(65 * 1024) }), context("companies/id/certificates")); expect(oversized.status).toBe(413); expect(fetchMock).toHaveBeenCalledOnce();
});
it("keeps upstream unavailable errors generic and preserves 204 deletion", async () => {
  fetchMock.mockRejectedValueOnce(new Error("internal secret URL"));
  const failed = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/auth/session"), context("auth/session")); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain("secret");
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  const deleted = await DELETE(new NextRequest("http://localhost:4000/api/proxy/v1/companies/id/certificates/cert", { method: "DELETE", headers: { origin: "http://localhost:4000" } }), context("companies/id/certificates/cert")); expect(deleted.status).toBe(204);
});

it("forwards the Stripe billing routes with their expected methods and nothing else", async () => {
  const allowed: [string, "GET" | "POST"][] = [["billing/checkout", "POST"], ["billing/checkout/cs_test_123", "GET"], ["billing/portal", "POST"], ["billing/upgrade", "POST"], ["billing/downgrade", "POST"]];
  for (const [route, method] of allowed) {
    fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin" } });
    const response = await (method === "GET" ? GET : POST)(request, context(route));
    expect(response.status, route).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://localhost:3000/v1/${route}`);
  }
  const wrongMethod = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/billing/checkout"), context("billing/checkout"));
  expect(wrongMethod.status).toBe(404);
});
it("forwards the pre-emission calculation and the company fiscal configuration routes", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const call = (handler: typeof POST, method: string, route: string) =>
    handler(new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers, body: method === "GET" ? undefined : "{}" }), context(route));
  expect((await call(POST, "POST", "invoices/calculate")).status).toBe(200);
  expect((await call(GET, "GET", "companies/id/fiscal-profile")).status).toBe(200);
  expect((await call(PUT, "PUT", "companies/id/fiscal-profile")).status).toBe(200);
  expect((await call(POST, "POST", "companies/id/fiscal-profile/profile/approve")).status).toBe(200);
  expect((await call(GET, "GET", "companies/id/service-tax-profiles")).status).toBe(200);
  expect((await call(POST, "POST", "companies/id/service-tax-profiles")).status).toBe(200);
  expect((await call(PATCH, "PATCH", "companies/id/service-tax-profiles/service")).status).toBe(200);
  expect((await call(POST, "POST", "companies/id/service-tax-profiles/service/approve")).status).toBe(200);
  expect((await call(DELETE, "DELETE", "invoices/calculate")).status).toBe(404);
});

it("forwards only the MCP consent and connection routes the dashboard needs", async () => {
  const allowed: [string, "GET" | "POST" | "DELETE"][] = [["mcp/consent", "GET"], ["mcp/consent", "POST"], ["mcp/connections", "GET"], ["mcp/connections/abc", "DELETE"]];
  for (const [route, method] of allowed) {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { origin: "http://localhost:4000" } });
    const handler = { GET, POST, DELETE }[method];
    expect((await handler(request, context(route))).status).toBe(200);
  }
  expect(fetchMock).toHaveBeenCalledTimes(allowed.length);
  fetchMock.mockClear();
  for (const [route, method] of [["mcp/token", "POST"], ["mcp/register", "POST"], ["mcp/authorize", "GET"], ["mcp/connections", "DELETE"], ["mcp", "POST"]] as const) {
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { origin: "http://localhost:4000" } });
    const handler = { GET, POST, DELETE }[method];
    expect((await handler(request, context(route))).status).toBe(404);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
