// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "@/app/(dashboard)/app/layout";
import { Sidebar } from "@/components/dashboard/sidebar";
import messages from "@/messages/en.json";
import { TENANT_ROLE_PERMISSIONS } from "../../api/src/modules/auth/domain/permission";

type Role = keyof typeof TENANT_ROLE_PERMISSIONS;
const state = vi.hoisted(() => ({ role: "admin" as string, pathname: "/app" }));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/lib/use-complete-registration", () => ({ useCompleteRegistration: () => undefined }));
vi.mock("@/components/dashboard/topbar", () => ({ Topbar: () => null }));
vi.mock("@/lib/auth", async () => {
  const { TENANT_ROLE_PERMISSIONS: roles } = await import("../../api/src/modules/auth/domain/permission");
  return {
    useAuth: () => {
      const granted = new Set<string>(roles[state.role as Role]);
      return {
        status: "authenticated", isAuthenticated: true, isLoading: false, tenantId: "t1", fiscalEnvironment: "test",
        refreshSession: vi.fn(), can: (permission: string) => granted.has(permission),
      };
    },
  };
});

const wrap = (node: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>;
const menu = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

beforeEach(() => { state.role = "admin"; state.pathname = "/app"; });
afterEach(cleanup);

describe("menu by role", () => {
  const renderMenu = (role: Role) => {
    state.role = role;
    render(wrap(<Sidebar activePath="/app" open onClose={() => undefined} />));
    return menu();
  };

  it("shows an admin everything", () => {
    expect(renderMenu("admin")).toEqual(expect.arrayContaining([
      "/app/companies", "/app/invoices", "/app/integrations", "/app/webhooks", "/app/api-keys", "/app/agents", "/app/billing", "/app/members", "/app/settings",
    ]));
  });

  it("hides members from a developer but keeps API keys and integrations", () => {
    const links = renderMenu("developer");
    expect(links).not.toContain("/app/members");
    expect(links).toEqual(expect.arrayContaining(["/app/api-keys", "/app/integrations", "/app/webhooks"]));
  });

  it("shows billing only what it can use", () => {
    const links = renderMenu("billing");
    expect(links).toEqual(expect.arrayContaining(["/app/companies", "/app/invoices", "/app/webhooks", "/app/billing"]));
    expect(links).not.toContain("/app/api-keys");
    expect(links).not.toContain("/app/integrations");
    expect(links).not.toContain("/app/members");
  });
});

describe("opening a page by its address", () => {
  const open = (role: Role, pathname: string) => {
    state.role = role;
    state.pathname = pathname;
    render(wrap(<DashboardLayout><p>page content</p></DashboardLayout>));
  };

  it.each([
    ["billing", "/app/api-keys"],
    ["billing", "/app/integrations"],
    ["billing", "/app/integrations/new"],
    ["billing", "/app/invoices/new"],
    ["billing", "/app/invoices/import"],
    ["developer", "/app/members"],
  ] as const)("%s opening %s sees a no-access page and none of its content", (role, path) => {
    open(role, path);
    expect(screen.getByRole("alert").textContent).toContain("No access to this page");
    expect(screen.queryByText("page content")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to overview" }).getAttribute("href")).toBe("/app");
  });

  it.each([
    ["admin", "/app/members"],
    ["developer", "/app/integrations/new"],
    ["billing", "/app/invoices"],
    ["billing", "/app"],
    ["billing", "/app/agents"],
  ] as const)("%s opening %s gets the page", (role, path) => {
    open(role, path);
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
