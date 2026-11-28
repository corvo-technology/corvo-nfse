import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/proxy/[...path]/route";

const fetchMock = vi.fn<typeof fetch>();
const context = (route: string) => ({ params: Promise.resolve({ path: ["v1", ...route.split("/")] }) });
const headers = { Origin: "http://localhost:4000", "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
const handlers = { GET, POST, PUT, PATCH, DELETE };
type Method = keyof typeof handlers;
const call = (method: Method, route: string) =>
  handlers[method](new NextRequest(`http://localhost:4000/api/proxy/v1/${route}`, { method, headers, body: method === "GET" ? undefined : "{}" }), context(route));

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:4000");
  vi.stubEnv("API_BASE_URL", "http://localhost:3000");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Every dashboard call of the NF-e / NFC-e / contingency / platform admin screens. */
const DASHBOARD_CALLS: [Method, string][] = [
  ["POST", "invoices/validate"],
  ["POST", "invoices"],
  ["GET", "invoices"],
  ["GET", "invoices/i1"],
  ["PUT", "invoices/i1"],
  ["POST", "invoices/i1/sync"],
  ["POST", "invoices/i1/cancel"],
  ["POST", "invoices/i1/corrections"],
  ["POST", "invoices/i1/discard"],
  ["GET", "invoices/i1/events"],
  ["GET", "invoices/i1/pdf"],
  ["GET", "invoices/i1/xml"],
  ["POST", "invoices/i1/download-url"],
  ["GET", "invoices/inutilizations"],
  ["POST", "invoices/inutilizations"],
  ["GET", "invoices/number-gaps"],
  ["GET", "companies/c1/nfe-settings"],
  ["PUT", "companies/c1/nfe-settings"],
  ["GET", "companies/c1/nfe-readiness"],
  ["GET", "platform/contingency"],
  ["POST", "platform/contingency/SP/2/exit"],
];

it.each(DASHBOARD_CALLS)("repassa %s %s", async (method, route) => {
  expect((await call(method, route)).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

/** The release of NF-e and NFC-e per workspace is gone: its admin routes are not forwarded any more. */
it.each([
  ["PUT", "platform/tenants/t1/nfe-access"],
  ["PUT", "platform/tenants/t1/nfce-access"],
] as const)("%s %s dá 404", async (method, route) => {
  expect((await call(method, route)).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

/** Drift guard: a path written in the NF-e or admin client that the proxy would refuse fails here. */
it.each(["lib/nfe.ts", "lib/platform-admin.ts"])("todo caminho de %s passa pelo proxy", async (file) => {
  const source = readFileSync(join(__dirname, "..", file), "utf8");
  const paths = [...source.matchAll(/request(?:<.*?>)?\(\s*([`"])(\/[^`"]*)\1/g)].map((m) =>
    m[2]
      .replace(/\$\{idPath\([^)]*\)\}/g, "x1")
      .replace(/\$\{[^}]*\}/g, "")
      .split("?")[0]
      .replace(/^\//, ""),
  );
  expect(paths.length).toBeGreaterThan(5);
  const unreachable: string[] = [];
  for (const route of paths) {
    let reached = false;
    for (const method of Object.keys(handlers) as Method[]) {
      fetchMock.mockClear();
      const response = await call(method, route.replace(/^platform\/contingency\/x1\/x1\/exit$/, "platform/contingency/SP/2/exit"));
      if (response.status !== 404) reached = true;
    }
    if (!reached) unreachable.push(route);
  }
  expect(unreachable).toEqual([]);
});
