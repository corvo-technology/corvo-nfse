import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/proxy/[...path]/route";
import { ApiError, customers, invoices, setCsrfToken } from "@/lib/api";

/**
 * Every call the web client makes for saved customers must be allowed by the proxy: the route list
 * is a second place to keep in step, and forgetting it answers 404 in the browser.
 */
const calls: Array<{ method: string; path: string }> = [];
const fetchMock = vi.fn<typeof fetch>();
const handlers = { GET, POST, PUT, PATCH, DELETE } as const;
const saved = { taxId: "52998224725", name: "Maria", email: null, lastUsedAt: "", createdAt: "", updatedAt: "" };

beforeEach(() => {
  calls.length = 0;
  setCsrfToken("csrf");
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => {
    calls.push({ method: String(init?.method ?? "GET"), path: String(input) });
    return Promise.resolve(new Response(JSON.stringify({ data: saved }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("web client and proxy agree on the customer routes", () => {
  it("every customers.* call is let through by the proxy", async () => {
    await Promise.allSettled([
      customers.list({ search: "maria", limit: 50 }), customers.find("52998224725"),
      customers.update("52998224725", { name: "Maria S." }), customers.remove("52998224725"),
    ]);
    const seen = calls.map((c) => `${c.method} ${c.path.replace("/api/proxy/v1/", "").split("?")[0]}`);
    expect(seen).toEqual(expect.arrayContaining([
      "GET customers", "GET customers/52998224725", "PATCH customers/52998224725", "DELETE customers/52998224725",
    ]));
    expect(calls[0]!.path).toContain("search=maria");

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000");
    for (const call of calls) {
      const route = call.path.replace("/api/proxy/", "").split("?")[0]!;
      const handler = handlers[call.method as keyof typeof handlers];
      const request = new NextRequest(`http://localhost:4000/api/proxy/${route}`, { method: call.method, headers: { origin: "http://localhost:4000" } });
      const response = await handler(request, { params: Promise.resolve({ path: route.split("/") }) });
      expect(response.status, `${call.method} ${route}`).not.toBe(404);
    }
    vi.unstubAllEnvs();
  });

  it("lets the substitute call through to the API", async () => {
    await Promise.allSettled([invoices.substitute("inv-1", { description: "Service description corrected" }, "key-1")]);
    expect(calls.map((c) => `${c.method} ${c.path.replace("/api/proxy/v1/", "")}`)).toContain("POST invoices/inv-1/substitute");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000");
    const request = new NextRequest("http://localhost:4000/api/proxy/v1/invoices/inv-1/substitute", { method: "POST", headers: { origin: "http://localhost:4000" } });
    const response = await POST(request, { params: Promise.resolve({ path: ["v1", "invoices", "inv-1", "substitute"] }) });
    expect(response.status).not.toBe(404);
    vi.unstubAllEnvs();
  });

  it("treats a customer that was never saved as null, and keeps other errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "ERROR_NOT_FOUND", message: "Customer not found" }), { status: 404 }));
    expect(await customers.find("52998224725")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "ERROR_INTERNAL", message: "boom" }), { status: 500 }));
    await expect(customers.find("52998224725")).rejects.toBeInstanceOf(ApiError);
  });
});
