import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/proxy/[...path]/route";

const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("forwards the CNPJ lookup with GET only", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  const call = (method: "GET" | "POST", route: string) =>
    (method === "GET" ? GET : POST)(new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers, body: method === "GET" ? undefined : "{}" }), context(route));
  expect((await call("GET", "cnpj/11222333000181")).status).toBe(200);
  fetchMock.mockClear();
  expect((await call("POST", "cnpj/11222333000181")).status).toBe(404);
  expect((await call("GET", "cnpj/123")).status).toBe(404);
  expect((await call("GET", "cnpj")).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
