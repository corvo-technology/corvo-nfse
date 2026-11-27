import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, PATCH, DELETE } from "@/app/api/proxy/[...path]/route";
const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("does not send a body (nor chunked encoding) when a POST has no body, but keeps JSON bodies", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" };
  await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/invitations/abc/resend", { method: "POST", headers }), context("auth/invitations/abc/resend"));
  const [, empty] = fetchMock.mock.calls[0];
  expect(empty?.body).toBeUndefined();
  expect(new Headers(empty?.headers).has("transfer-encoding")).toBe(false);
  await POST(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/id/cancel", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: '{"reason":"1"}' }), context("invoices/id/cancel"));
  const [, json] = fetchMock.mock.calls[1];
  expect(new TextDecoder().decode(json?.body as Uint8Array)).toBe('{"reason":"1"}');
  expect(new Headers(json?.headers).get("content-type")).toBe("application/json");
});
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
  const allowed: [string, "GET" | "POST"][] = [["billing/checkout", "POST"], ["billing/checkout/cs_test_123", "GET"], ["billing/portal", "POST"], ["billing/upgrade", "POST"], ["billing/downgrade", "POST"], ["billing/pix/cancel", "POST"], ["billing/payments", "GET"], ["billing/payments/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc/status", "GET"]];
  for (const [route, method] of allowed) {
    fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin" } });
    const response = await (method === "GET" ? GET : POST)(request, context(route));
    expect(response.status, route).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://localhost:3000/v1/${route}`);
  }
  const wrongMethod = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/billing/checkout"), context("billing/checkout"));
  expect(wrongMethod.status).toBe(404);
  const wrongPixMethod = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/billing/pix/cancel"), context("billing/pix/cancel"));
  expect(wrongPixMethod.status).toBe(404);
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
  expect((await call(GET, "GET", "companies/id/simples-rates")).status).toBe(404);
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

it("forwards the invoice cancellation with POST only", async () => {
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 202 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const response = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/id/cancel", { method: "POST", headers, body: '{"reason":"1"}' }), context("invoices/id/cancel"));
  expect(response.status).toBe(202);
  expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:3000/v1/invoices/id/cancel");
  fetchMock.mockClear();
  expect((await GET(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/id/cancel"), context("invoices/id/cancel"))).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("forwards the payment integration management routes, but never the public inbound webhook", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const handlers = { GET, POST, PUT, PATCH };
  const call = (method: keyof typeof handlers, route: string) =>
    handlers[method](new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers, body: method === "GET" ? undefined : "{}" }), context(route));
  const allowed: [keyof typeof handlers, string][] = [
    ["GET", "integrations/providers"], ["GET", "integrations/connections"], ["POST", "integrations/connections"], ["GET", "integrations/connections/c1"],
    ["POST", "integrations/connections/c1/validate"], ["POST", "integrations/connections/c1/activate"], ["POST", "integrations/connections/c1/pause"], ["POST", "integrations/connections/c1/disconnect"],
    ["GET", "integrations/connections/c1/rules"], ["PUT", "integrations/connections/c1/rules"], ["GET", "integrations/connections/c1/events"], ["GET", "integrations/connections/c1/operations"],
    ["PUT", "integrations/connections/c1/credentials"], ["PATCH", "integrations/operations/o1/customer"], ["POST", "integrations/operations/o1/retry"],
  ];
  for (const [method, route] of allowed) expect((await call(method, route)).status, `${method} ${route}`).toBe(200);
  fetchMock.mockClear();
  expect((await call("POST", "integrations/inbound/abc")).status).toBe(404);
  expect((await call("GET", "integrations/connections/c1/pause")).status).toBe(404);
  expect((await call("PUT", "integrations/connections")).status).toBe(404);
  expect((await call("GET", "integrations/connections/c1/credentials")).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("forwards the browser IP only with the shared secret, preferring the last x-forwarded-for entry", async () => {
  vi.stubEnv("PROXY_SHARED_SECRET", "s".repeat(32));
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "x-forwarded-for": "203.0.113.1, 198.51.100.7", "cf-connecting-ip": "203.0.113.99" };
  await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/magic-link/request", { method: "POST", headers }), context("auth/magic-link/request"));
  const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(sent.get("x-corvo-client-ip")).toBe("198.51.100.7"); expect(sent.get("x-corvo-proxy-secret")).toBe("s".repeat(32));
  vi.stubEnv("TRUST_CF_CONNECTING_IP", "true"); fetchMock.mockClear();
  await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/magic-link/request", { method: "POST", headers }), context("auth/magic-link/request"));
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-corvo-client-ip")).toBe("203.0.113.99");
});
it("does not send IP headers when no shared secret is configured", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  await POST(new NextRequest("http://localhost:4000/api/proxy/v1/auth/magic-link/request", { method: "POST", headers: { Origin: "http://localhost:4000", "x-forwarded-for": "198.51.100.7" } }), context("auth/magic-link/request"));
  const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(sent.has("x-corvo-client-ip")).toBe(false); expect(sent.has("x-corvo-proxy-secret")).toBe(false);
});
it("forwards the spreadsheet import routes with their methods, and allows a 10 MB upload only there", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const origin = { origin: "http://localhost:4000" };
  const call = (run: typeof GET, route: string, method: string, extra: RequestInit = {}) =>
    run(new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: origin, ...extra }), context(route));
  for (const [run, route, method] of [
    [POST, "imports", "POST"], [GET, "imports", "GET"], [GET, "imports/template", "GET"], [GET, "imports/abc", "GET"], [DELETE, "imports/abc", "DELETE"],
    [GET, "imports/abc/rows", "GET"], [PATCH, "imports/abc/rows/4", "PATCH"], [POST, "imports/abc/emit", "POST"], [GET, "imports/abc/errors.csv", "GET"],
  ] as const) expect((await call(run, route, method)).status).not.toBe(404);
  for (const [run, route, method] of [[PUT, "imports/abc", "PUT"], [POST, "imports/abc", "POST"], [DELETE, "imports", "DELETE"], [PUT, "imports", "PUT"], [GET, "imports/abc/other", "GET"]] as const)
    expect((await call(run, route, method)).status).toBe(404);
  const headers = { ...origin, "Content-Type": "multipart/form-data; boundary=test" };
  const big = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/imports", { method: "POST", headers, body: "x".repeat(5 * 1024 * 1024) }), context("imports"));
  expect(big.status).toBe(200);
  const tooBig = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/imports", { method: "POST", headers, body: "x".repeat(11 * 1024 * 1024) }), context("imports"));
  expect(tooBig.status).toBe(413);
  const otherRoute = await PATCH(new NextRequest("http://localhost:4000/api/proxy/v1/imports/abc/rows/4", { method: "PATCH", headers, body: "x".repeat(2 * 1024 * 1024) }), context("imports/abc/rows/4"));
  expect(otherRoute.status).toBe(413);
});

it("forwards the member invitation routes with their methods, and nothing else under auth/invitations", async () => {
  const allowed: [string, "GET" | "POST" | "DELETE"][] = [
    ["auth/invite", "POST"], ["auth/invitations", "GET"], ["auth/invitations/preview", "POST"], ["auth/invitations/accept", "POST"],
    ["auth/invitations/abc/resend", "POST"], ["auth/invitations/abc", "DELETE"],
  ];
  for (const [route, method] of allowed) {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { origin: "http://localhost:4000" } });
    const handler = { GET, POST, DELETE }[method];
    expect((await handler(request, context(route))).status, `${method} ${route}`).toBe(200);
  }
  expect(fetchMock).toHaveBeenCalledTimes(allowed.length);
  fetchMock.mockClear();
  for (const [route, method] of [["auth/invitations", "POST"], ["auth/invitations/preview", "GET"], ["auth/invitations/abc", "GET"], ["auth/invitations/abc/resend", "GET"], ["auth/invitations/abc/accept", "POST"]] as const) {
    const request = new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { origin: "http://localhost:4000" } });
    const handler = { GET, POST, DELETE }[method];
    expect((await handler(request, context(route))).status, `${method} ${route}`).toBe(404);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it("forwards the profile name update with PATCH only", async () => {
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const response = await PATCH(new NextRequest("http://localhost:4000/api/proxy/v1/auth/profile", { method: "PATCH", headers, body: '{"name":"Ana"}' }), context("auth/profile"));
  expect(response.status).toBe(200);
  expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:3000/v1/auth/profile");
  fetchMock.mockClear();
  for (const handler of [GET, POST, DELETE]) expect((await handler(new NextRequest("http://localhost:4000/api/proxy/v1/auth/profile", { method: handler === GET ? "GET" : handler === POST ? "POST" : "DELETE", headers: { origin: "http://localhost:4000" } }), context("auth/profile"))).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("forwards GET audit-events and refuses POST", async () => {
  fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const ok = await GET(new NextRequest("http://localhost:4000/api/proxy/v1/audit-events?actor_type=agent&limit=50"), context("audit-events"));
  expect(ok.status).toBe(200);
  expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:3000/v1/audit-events?actor_type=agent&limit=50");
  const refused = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/audit-events", { method: "POST", headers: { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin" } }), context("audit-events"));
  expect(refused.status).toBe(404);
});
it("answers an unlisted route with a code the dashboard can show, and lets the manual-review routes through", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
  const headers = { origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "content-type": "application/json" };
  const review = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/review", { method: "POST", headers, body: "{}" }), context("invoices/review"));
  expect(review.status).toBe(202);
  fetchMock.mockClear();
  const blocked = await POST(new NextRequest("http://localhost:4000/api/proxy/v1/invoices/unknown/nope", { method: "POST", headers, body: "{}" }), context("invoices/unknown/nope"));
  expect(blocked.status).toBe(404);
  expect(await blocked.json()).toEqual({ statusCode: 404, message: "Route unavailable", code: "proxy_route_unavailable" });
  expect(fetchMock).not.toHaveBeenCalled();
});
