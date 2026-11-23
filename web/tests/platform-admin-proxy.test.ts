import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/proxy/[...path]/route";

const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
const handlers = { GET, POST, DELETE };
const call = (method: keyof typeof handlers, route: string, extra: Record<string, string> = {}) =>
  handlers[method](new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers: { ...headers, ...extra }, body: method === "GET" ? undefined : "{}" }), context(route));
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("repassa exatamente as seis rotas do admin com seus métodos", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  for (const [method, route] of [["GET", "platform/overview"], ["GET", "platform/users"], ["GET", "platform/users/u1"], ["GET", "platform/attention"], ["GET", "platform/audit"], ["POST", "platform/tenants/t1/credit-grants"]] as const)
    expect((await call(method, route)).status, `${method} ${route}`).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(6);
});
it.each([["platform/users", "POST"], ["platform/users/x", "DELETE"], ["platform/tenants/x/credit-grants", "GET"], ["platform/tenants/x/credit-grants/y", "POST"], ["platform/anything", "GET"]] as const)("%s %s dá 404", async (route, method) => {
  expect((await call(method, route)).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("repassa o idempotency-key da concessão", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  await call("POST", "platform/tenants/t1/credit-grants", { "idempotency-key": "key-1" });
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key")).toBe("key-1");
});
