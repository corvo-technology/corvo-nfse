import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canOpenPath, isPlatformAdminPath, permissionForPath, ROUTE_PERMISSION_RULES } from "@/lib/route-permissions";
import { TENANT_ADMIN_PERMISSIONS, TENANT_ROLE_PERMISSIONS } from "../../api/src/modules/auth/domain/permission";

const asCan = (role: keyof typeof TENANT_ROLE_PERMISSIONS) => {
  const granted = new Set<string>(TENANT_ROLE_PERMISSIONS[role]);
  return (permission: string) => granted.has(permission);
};

describe("permissionForPath", () => {
  it.each([
    ["/app/invoices/new", "nfse.invoices.issue"],
    ["/app/invoices/import", "nfse.invoices.issue"],
    ["/app/invoices", "nfse.invoices.view"],
    ["/app/invoices/abc-123", "nfse.invoices.view"],
    ["/app/schedules/abc", "nfse.invoices.view"],
    ["/app/companies/abc", "nfse.companies.view"],
    ["/app/integrations/new", "integrations.manage"],
    ["/app/integrations/abc", "integrations.view"],
    ["/app/billing/success", "billing.view"],
    ["/app/members", "settings.manage"],
    ["/app/members/", "settings.manage"],
    ["/app/members?x=1", "settings.manage"],
  ])("%s needs %s", (path, permission) => {
    expect(permissionForPath(path)).toBe(permission);
  });

  it.each(["/app", "/app/agents", "/app/unknown-page"])("%s is open to every member", (path) => {
    expect(permissionForPath(path)).toBeNull();
  });

  it("matches whole path segments, never a longer name that starts the same", () => {
    expect(permissionForPath("/app/invoices-archive")).toBeNull();
    expect(permissionForPath("/app/membership")).toBeNull();
  });
});

describe("the table agrees with the API", () => {
  it("only names permissions the API defines", () => {
    for (const [, permission] of ROUTE_PERMISSION_RULES) expect(TENANT_ADMIN_PERMISSIONS).toContain(permission);
  });

  it("gives an admin every page", () => {
    for (const [prefix] of ROUTE_PERMISSION_RULES) expect(canOpenPath(prefix, asCan("admin"))).toBe(true);
  });

  const pages = (role: keyof typeof TENANT_ROLE_PERMISSIONS) =>
    ROUTE_PERMISSION_RULES.map(([prefix]) => prefix).filter((prefix) => canOpenPath(prefix, asCan(role)));

  it("keeps a developer out of members and the billing role out of API keys and integrations", () => {
    expect(pages("developer")).not.toContain("/app/members");
    expect(pages("developer")).toContain("/app/api-keys");
    expect(pages("billing")).not.toContain("/app/api-keys");
    expect(pages("billing")).not.toContain("/app/integrations");
    expect(pages("billing")).not.toContain("/app/members");
  });

  it("lets billing see invoices but not issue them or import", () => {
    expect(pages("billing")).toContain("/app/invoices");
    expect(pages("billing")).not.toContain("/app/invoices/new");
    expect(pages("billing")).not.toContain("/app/invoices/import");
  });
});

/** A new page must either get a rule or be added to this short list on purpose. */
const OPEN_TO_ALL = new Set(["/app", "/app/agents"]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name === "page.tsx" ? [path] : [];
  });

describe("every dashboard page is covered", () => {
  const root = join(process.cwd(), "app", "(dashboard)", "app");
  const routes = walk(root).map((file) => `/app${file.slice(root.length).replace(/\\/g, "/").replace(/\/page\.tsx$/, "").replace(/\[[^/]+\]/g, "x")}`);

  it("finds the pages (the scan is not silently empty)", () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(routes).toContain("/app/companies/x");
    expect(routes).toContain("/app");
  });

  it.each(routes)("%s has a rule or is open on purpose", (route) => {
    expect(permissionForPath(route) !== null || OPEN_TO_ALL.has(route) || isPlatformAdminPath(route)).toBe(true);
  });

  it("platform admin pages need no tenant permission (the server-side admin gate decides)", () => {
    const adminRoutes = routes.filter(isPlatformAdminPath);
    expect(adminRoutes).toContain("/app/admin");
    expect(adminRoutes).toContain("/app/admin/users/x");
    for (const route of adminRoutes) expect(permissionForPath(route)).toBeNull();
    expect(isPlatformAdminPath("/app/administration")).toBe(false);
  });
});
