import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT } from "@/app/api/proxy/[...path]/route";

const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("forwards the month package and accountant routes with their methods only", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const handlers = { GET, POST, PUT };
  const call = (method: keyof typeof handlers, route: string) =>
    handlers[method](new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers, body: method === "GET" ? undefined : "{}" }), context(route));
  for (const [method, route] of [["GET", "companies/c1/invoice-package"], ["GET", "companies/c1/invoice-package/summary"], ["GET", "companies/c1/accountant-package"], ["PUT", "companies/c1/accountant-package"], ["POST", "companies/c1/accountant-package/send"]] as const)
    expect((await call(method, route)).status, `${method} ${route}`).toBe(200);
  fetchMock.mockClear();
  expect((await call("POST", "companies/c1/invoice-package")).status).toBe(404);
  expect((await call("GET", "invoice-package-links/token")).status).toBe(404);
  expect((await call("GET", "companies/c1/accountant-package/send")).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
