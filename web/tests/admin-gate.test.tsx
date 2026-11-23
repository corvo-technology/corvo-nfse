// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({
  cookies: [] as { name: string; value: string }[],
  isPlatformAdmin: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => state.cookies }),
}));
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound, usePathname: () => "/app", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    status: "authenticated", isAuthenticated: true, isLoading: false, tenantId: "t1", fiscalEnvironment: "test",
    isPlatformAdmin: state.isPlatformAdmin, refreshSession: vi.fn(), can: () => true,
  }),
}));

import { isPlatformAdminOnServer } from "@/lib/platform-admin-server";
import AdminLayout from "@/app/(dashboard)/app/admin/layout";
import { Sidebar } from "@/components/dashboard/sidebar";

const fetchMock = vi.fn();
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  notFound.mockClear();
  state.cookies = [{ name: "gf_session_dev", value: "abc" }];
  state.isPlatformAdmin = false;
  process.env.API_BASE_URL = "http://api.test";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("isPlatformAdminOnServer", () => {
  it("true só quando a sessão diz isPlatformAdmin === true", async () => {
    fetchMock.mockResolvedValue(ok({ data: { isPlatformAdmin: true } }));
    expect(await isPlatformAdminOnServer()).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://api.test/v1/auth/session");
  });

  it.each([
    ["sem cookie (e não chama fetch)", () => { state.cookies = []; }, null],
    ["401", () => {}, () => ok({}, 401)],
    ["erro de rede", () => {}, () => { throw new Error("down"); }],
    ["corpo sem a flag", () => {}, () => ok({ data: {} })],
    ['isPlatformAdmin: "true"', () => {}, () => ok({ data: { isPlatformAdmin: "true" } })],
  ])("%s => false", async (name, setup, response) => {
    setup();
    if (response) fetchMock.mockImplementation(async () => response());
    expect(await isPlatformAdminOnServer()).toBe(false);
    if (name.startsWith("sem cookie")) expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encaminha só os cookies de sessão", async () => {
    state.cookies = [
      { name: "gf_session_dev", value: "abc" },
      { name: "__Host-gf_session", value: "def" },
      { name: "analytics", value: "zzz" },
    ];
    fetchMock.mockResolvedValue(ok({ data: { isPlatformAdmin: false } }));
    await isPlatformAdminOnServer();
    const cookie = (fetchMock.mock.calls[0][1].headers as Record<string, string>).cookie;
    expect(cookie).toBe("gf_session_dev=abc; __Host-gf_session=def");
  });
});

describe("layout de /app/admin", () => {
  it("chama notFound() para não admin e renderiza os filhos para admin", async () => {
    fetchMock.mockResolvedValue(ok({ data: { isPlatformAdmin: false } }));
    await expect(AdminLayout({ children: <p>secret</p> })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();

    fetchMock.mockResolvedValue(ok({ data: { isPlatformAdmin: true } }));
    render(<NextIntlClientProvider locale="en" messages={messages}>{await AdminLayout({ children: <p>secret</p> })}</NextIntlClientProvider>);
    expect(screen.getByText("secret")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: messages.Admin.navLabel })).toBeTruthy();
  });
});

describe("Sidebar", () => {
  const links = () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><Sidebar activePath="/app" open onClose={() => undefined} /></NextIntlClientProvider>);
    return screen.getAllByRole("link").map((l) => l.getAttribute("href"));
  };

  it("mostra o link /app/admin só quando isPlatformAdmin", () => {
    state.isPlatformAdmin = true;
    expect(links()).toContain("/app/admin");
  });

  it("menu comum de membro não ganha nenhum link novo", () => {
    expect(links().filter((h) => h?.startsWith("/app/admin"))).toEqual([]);
  });
});
