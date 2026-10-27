import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Old URLs without locale still indexed by Google (Search Console, 27/10/2026).
 * Explicit list on purpose, no generic pattern: each one moves to the pt page with a single 301.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/docs/sdks": "/pt/docs/sdks",
  "/docs/authentication": "/pt/docs/authentication",
  "/docs/errors": "/pt/docs/errors",
  "/docs/rate-limits": "/pt/docs/rate-limits",
  "/docs/companies": "/pt/docs/companies",
  "/docs/certificates": "/pt/docs/certificates",
  "/docs/invoices": "/pt/docs/invoices",
  "/docs/webhooks": "/pt/docs/webhooks",
  "/docs/billing": "/pt/docs/billing",
  "/docs/async-issuance": "/pt/docs/async-issuance",
  "/docs/pagination": "/pt/docs/pagination",
  "/docs/receiving-webhooks": "/pt/docs/receiving-webhooks",
  "/docs/integration-checklist": "/pt/docs/integration-checklist",
  "/docs/mcp": "/pt/docs/mcp",
  "/docs/llms": "/pt/docs/llms",
  "/terms": "/pt/terms",
  "/privacy": "/pt/privacy",
  "/dpa": "/pt/dpa",
  "/security": "/pt/security",
  "/status": "/pt/status",
  "/brand": "/pt/brand",
};

const publicPaths = new Set([
  "/",
  "/login",
  "/app",
  "/mcp/authorize",
  "/docs",
  "/brand",
  "/dpa",
  "/privacy",
  "/security",
  "/status",
  "/terms",
]);

const isPublicPath = (logicalPath: string) =>
  publicPaths.has(logicalPath) ||
  logicalPath.startsWith("/app") ||
  logicalPath === "/docs" ||
  logicalPath.startsWith("/docs/");

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const legacyTarget = LEGACY_REDIRECTS[pathname];
  if (legacyTarget) {
    return NextResponse.redirect(new URL(legacyTarget, request.url), 301);
  }

  // Detect locale from cookie or path
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const pathLocale = pathname.match(/^\/(en|pt)/)?.[1];
  const locale = pathLocale || cookieLocale || "en";

  // Skip i18n routing for paths outside [locale] (e.g., /login, /api)
  const hasLocalePrefix = /^\/(en|pt)(\/|$)/.test(pathname);
  const isNonLocalePath = !hasLocalePrefix && pathname !== "/";

  if (isNonLocalePath) {
    // Access control only — no i18n routing
    if (process.env.SITE_ACCESS_MODE === "open") {
      return NextResponse.next();
    }
    const logicalPath = pathname.replace(/^\/(en|pt)(\/|$)/, "/") || "/";
    if (isPublicPath(logicalPath)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  // i18n routing for locale-prefixed paths and root
  const response = handleI18nRouting(request);

  // Access control — skip if site is open
  if (process.env.SITE_ACCESS_MODE === "open") {
    return response;
  }

  // Strip locale prefix to get the logical path
  const logicalPath = pathname.replace(/^\/(en|pt)(\/|$)/, "/") || "/";

  if (isPublicPath(logicalPath)) {
    return response;
  }

  // Redirect non-public paths to home in the same locale
  return NextResponse.redirect(new URL(`/${locale}`, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*$).*)"],
};
