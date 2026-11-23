import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCsrfToken } from "@/lib/api";
import { formatBrl, platformAdmin } from "@/lib/platform-admin";

const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
beforeEach(() => { setCsrfToken("csrf"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); setCsrfToken(null); });

it("grantCredits envia POST com idempotency-key e tenantId codificado", async () => {
  fetchMock.mockResolvedValue(reply({ data: { tenantId: "a/b", amount: 5, balance: 9, replayed: false } }));
  const result = await platformAdmin.grantCredits("a/b", { amount: 5, reason: "cortesia", notifyUser: false }, "key-1");
  expect(result.balance).toBe(9);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/proxy/v1/platform/tenants/a%2Fb/credit-grants");
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("idempotency-key")).toBe("key-1");
  expect(JSON.parse(String(init?.body))).toEqual({ amount: 5, reason: "cortesia", notifyUser: false });
});
it("users monta search e limit na query", async () => {
  fetchMock.mockResolvedValue(reply({ data: [], pagination: { limit: 20, hasMore: false, nextCursor: null } }));
  const page = await platformAdmin.users({ search: "ana", limit: 20 });
  expect(page.items).toEqual([]);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/platform/users?search=ana&limit=20");
});
it("user codifica o id", async () => {
  fetchMock.mockResolvedValue(reply({ data: { user: {}, workspaces: [] } }));
  await platformAdmin.user("x/y");
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/platform/users/x%2Fy");
});
it("formatBrl(1990, 'pt') contém '19,90'", () => expect(formatBrl(1990, "pt")).toContain("19,90"));
it("audit monta limit e cursor na query", async () => {
  fetchMock.mockResolvedValue(reply({ data: [{ id: "a1" }], pagination: { limit: 10, hasMore: true, nextCursor: "c2" } }));
  const page = await platformAdmin.audit({ limit: 10, cursor: "c1" });
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/proxy/v1/platform/audit?limit=10&cursor=c1");
  expect(page).toEqual({ items: [{ id: "a1" }], hasMore: true, nextCursor: "c2" });
});
