import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/proxy/[...path]/route";
import { imports, setCsrfToken } from "@/lib/api";

/**
 * Every call the web client makes for imports must be allowed by the proxy. The route list is a
 * second place that has to be kept in step with the client, and forgetting it answers 404 in the browser.
 */
const calls: Array<{ method: string; path: string }> = [];
const fetchMock = vi.fn<typeof fetch>();
const handlers = { GET, POST, PUT, PATCH, DELETE } as const;

beforeEach(() => {
  calls.length = 0;
  setCsrfToken("csrf");
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => {
    calls.push({ method: String(init?.method ?? "GET"), path: String(input) });
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("web client and proxy agree on the import routes", () => {
  it("every imports.* call is let through by the proxy", async () => {
    const file = new File(["valor\n1\n"], "n.csv");
    await Promise.allSettled([
      imports.start(file), imports.list(5), imports.get("i1"), imports.rows("i1", { status: "invalid", limit: 50 }),
      imports.updateRow("i1", 4, { amount: 1 }), imports.emit("i1"), imports.discard("i1"), imports.errorsCsv("i1"), imports.template(),
    ]);
    const seen = calls.map((c) => `${c.method} ${c.path.replace("/api/proxy/v1/", "").split("?")[0]}`);
    expect(seen).toEqual(expect.arrayContaining([
      "POST imports", "GET imports", "GET imports/i1", "GET imports/i1/rows", "PATCH imports/i1/rows/4",
      "POST imports/i1/emit", "DELETE imports/i1", "GET imports/i1/errors.csv", "GET imports/template",
    ]));

    vi.unstubAllGlobals();
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
});
