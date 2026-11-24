import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/proxy/[...path]/route";
import { invoices, serviceFavorites, setCsrfToken } from "@/lib/api";

const calls: Array<{ method: string; path: string }> = [];
const handlers = { GET, POST, DELETE } as const;

beforeEach(() => {
  calls.length = 0;
  setCsrfToken("csrf");
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: String(init?.method ?? "GET"), path: String(input) });
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("web client and proxy agree on the service favorites routes", () => {
  it("every serviceFavorites.* call is let through by the proxy", async () => {
    await Promise.allSettled([
      serviceFavorites.list("company-1"),
      serviceFavorites.create("company-1", { label: "Mensalidade", description: "Consultoria", serviceCode: "010101" }),
      serviceFavorites.remove("company-1", "fav-1"),
    ]);
    expect(calls.map((c) => `${c.method} ${c.path.replace("/api/proxy/v1/", "")}`)).toEqual([
      "GET companies/company-1/service-favorites", "POST companies/company-1/service-favorites", "DELETE companies/company-1/service-favorites/fav-1",
    ]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    vi.stubEnv("APP_ORIGIN", "http://localhost:4000"); vi.stubEnv("API_BASE_URL", "http://localhost:3000");
    for (const call of calls) {
      const route = call.path.replace("/api/proxy/", "").split("?")[0]!;
      const request = new NextRequest(`http://localhost:4000/api/proxy/${route}`, { method: call.method, headers: { origin: "http://localhost:4000" } });
      const response = await handlers[call.method as keyof typeof handlers](request, { params: Promise.resolve({ path: route.split("/") }) });
      expect(response.status, `${call.method} ${route}`).not.toBe(404);
    }
  });

  it("sends the customer document when listing invoices for the last-invoice shortcut", async () => {
    await Promise.allSettled([invoices.list({ companyId: "c1", customerTaxId: "52998224725", status: "authorized", limit: 1 })]);
    expect(calls[0]!.path).toContain("customerTaxId=52998224725");
  });
});
