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
  ["/app/settings", "billing.view"],
];

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
