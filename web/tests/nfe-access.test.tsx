// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "@/app/(dashboard)/app/layout";
import { Sidebar } from "@/components/dashboard/sidebar";
import { canOpenPath, permissionForPath } from "@/lib/route-permissions";
import messages from "@/messages/en.json";
import { TENANT_ROLE_PERMISSIONS } from "../../api/src/modules/auth/domain/permission";

type Role = keyof typeof TENANT_ROLE_PERMISSIONS;
const state = vi.hoisted(() => ({ role: "admin" as string, pathname: "/app", nfe: true }));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), billing: { plan: vi.fn().mockResolvedValue(null) } }));
vi.mock("@/lib/use-complete-registration", () => ({ useCompleteRegistration: () => undefined }));
vi.mock("@/components/dashboard/topbar", () => ({ Topbar: () => null }));
vi.mock("@/lib/auth", async () => {
  const { TENANT_ROLE_PERMISSIONS: roles } = await import("../../api/src/modules/auth/domain/permission");
  return {
    useAuth: () => {
      const granted = new Set<string>(roles[state.role as Role]);
      return {
        status: "authenticated", isAuthenticated: true, isLoading: false, tenantId: "t1", fiscalEnvironment: "test", isPlatformAdmin: false,
        features: { nfe: state.nfe }, refreshSession: vi.fn(), can: (permission: string) => granted.has(permission),
      };
    },
  };
});

const wrap = (node: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>;
const links = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

beforeEach(() => { state.role = "admin"; state.pathname = "/app"; state.nfe = true; });
afterEach(cleanup);

describe("route permissions of the NF-e pages", () => {
  it("each NF-e page names its permission, the most specific first", () => {
    expect(permissionForPath("/app/nfe")).toBe("nfe.documents.view");
    expect(permissionForPath("/app/nfe/abc")).toBe("nfe.documents.view");
    expect(permissionForPath("/app/nfe/number-gaps")).toBe("nfe.documents.view");
    expect(permissionForPath("/app/nfe/new")).toBe("nfe.documents.issue");
  });

  it("the pages are closed while NF-e is not released, whatever the role", () => {
    const all = () => true;
    expect(canOpenPath("/app/nfe", all, { nfe: false })).toBe(false);
    expect(canOpenPath("/app/nfe/new", all, undefined)).toBe(false);
    expect(canOpenPath("/app/nfe", all, { nfe: true })).toBe(true);
    // The NFS-e pages do not depend on the release.
    expect(canOpenPath("/app/invoices", all, { nfe: false })).toBe(true);
  });
});

describe("menu", () => {
  const renderMenu = (role: Role) => { state.role = role; render(wrap(<Sidebar activePath="/app" open onClose={() => undefined} />)); return links(); };

  it("shows NF-e only when it was released and the role may view it", () => {
    expect(renderMenu("admin")).toContain("/app/nfe");
  });

  it("hides NF-e from the menu while it is not released", () => {
    state.nfe = false;
    expect(renderMenu("admin")).not.toContain("/app/nfe");
    expect(links()).toContain("/app/invoices");
  });
});

describe("page guard", () => {
  const renderAt = (pathname: string) => { state.pathname = pathname; render(wrap(<DashboardLayout><p>page body</p></DashboardLayout>)); };

  it("opens the NF-e page when released", () => {
    renderAt("/app/nfe");
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("shows the no-access screen instead of the NF-e page when it is not released", () => {
    state.nfe = false;
    renderAt("/app/nfe/new");
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps the NFS-e pages open when NF-e is not released", () => {
    state.nfe = false;
    renderAt("/app/invoices");
    expect(screen.getByText("page body")).toBeTruthy();
  });
});
