import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/proxy/[...path]/route";
import { integrations, setCsrfToken } from "@/lib/api";

/** Every call the pending-sales screens make must be let through by the proxy (a miss answers 404 in the browser). */
const calls: Array<{ method: string; path: string }> = [];
const handlers = { GET, POST, PUT, PATCH, DELETE } as const;

beforeEach(() => {
  calls.length = 0;
  setCsrfToken("csrf");
  vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
    calls.push({ method: String(init?.method ?? "GET"), path: String(input) });
    return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function through(method: string, route: string) {
  vi.stubEnv("APP_ORIGIN", "http://localhost:4000");
  vi.stubEnv("API_BASE_URL", "http://localhost:3000");
  const request = new NextRequest(`http://localhost:4000/api/proxy/${route}`, { method, headers: { origin: "http://localhost:4000" } });
  return handlers[method as keyof typeof handlers](request, { params: Promise.resolve({ path: route.split("/") }) });
}

describe("web client and proxy agree on the pending-sales routes", () => {
  it("every pending-sales call is let through by the proxy", async () => {
    await Promise.allSettled([
      integrations.pending("live"), integrations.sale("op_1"),
      integrations.resolve("op_1", { customer: { taxId: "52998224725" } }), integrations.ignore("op_1", "duplicada"),
    ]);
    const seen = calls.map((c) => `${c.method} ${c.path.replace("/api/proxy/", "").split("?")[0]}`);
    expect(seen).toEqual(["GET v1/integrations/operations", "GET v1/integrations/operations/op_1", "POST v1/integrations/operations/op_1/resolve", "POST v1/integrations/operations/op_1/ignore"]);
    for (const call of [...calls]) {
      const route = call.path.replace("/api/proxy/", "").split("?")[0]!;
      expect((await through(call.method, route)).status, `${call.method} ${route}`).not.toBe(404);
    }
  });

  it("still refuses other methods and unknown operation routes", async () => {
    expect((await through("DELETE", "v1/integrations/operations/op_1")).status).toBe(404);
    expect((await through("POST", "v1/integrations/operations")).status).toBe(404);
    expect((await through("GET", "v1/integrations/operations/op_1/resolve")).status).toBe(404);
    expect((await through("POST", "v1/integrations/operations/op_1/other")).status).toBe(404);
  });
});
