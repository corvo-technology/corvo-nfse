/**
 * Which permission opens each dashboard page. The API enforces the same permissions on every call;
 * this table only keeps the screens in step so a member is never sent to a page that would just fail.
 * The menu and the page guard both read it, so they cannot drift apart.
 *
 * Pages that are not listed (the overview and AI agents) are open to every member: each shows only
 * what the member's permissions allow.
 */
const ROUTE_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: string]> = [
  // More specific paths first: the first match wins.
  ["/app/invoices/new", "nfse.invoices.issue"],
  ["/app/invoices/import", "nfse.invoices.issue"],
  ["/app/invoices", "nfse.invoices.view"],
  ["/app/schedules", "nfse.invoices.view"],
  ["/app/customers", "nfse.invoices.view"],
  ["/app/companies", "nfse.companies.view"],
  ["/app/integrations/new", "integrations.manage"],
  ["/app/integrations", "integrations.view"],
  ["/app/webhooks", "webhooks.view"],
  ["/app/api-keys", "api_keys.manage"],
  ["/app/billing", "billing.view"],
  ["/app/members", "settings.manage"],
  ["/app/settings/audit", "settings.manage"],
  ["/app/settings", "billing.view"],
];

/**
 * The platform admin pages need no tenant permission on purpose: access is decided only by the
 * server-side admin gate (app/(dashboard)/app/admin/layout.tsx), never by a member's role.
 */
export function isPlatformAdminPath(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return path === "/app/admin" || path.startsWith("/app/admin/");
}

/** The permission a page needs, or null when every member may open it. */
export function permissionForPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const [prefix, permission] of ROUTE_PERMISSIONS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return permission;
  }
  return null;
}

/** True when the member may open the page. */
export function canOpenPath(pathname: string, can: (permission: string) => boolean): boolean {
  const permission = permissionForPath(pathname);
  return permission === null || can(permission);
}

/** Every rule, for tests that keep the table honest. */
export const ROUTE_PERMISSION_RULES = ROUTE_PERMISSIONS;

/** The section a page inside it belongs to (`/app/companies/abc` is in `/app/companies`): the longest listed prefix. The overview and the admin pages are never a parent. */
export function parentSection(pathname: string, sections: readonly string[]): string | undefined {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (path.startsWith("/app/admin/")) return undefined;
  return sections.filter((section) => section !== "/app" && path.startsWith(`${section}/`)).sort((a, b) => b.length - a.length)[0];
}
