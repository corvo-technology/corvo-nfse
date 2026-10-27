import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

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

/** Pages removed for good: 410 tells Google to drop them faster than a 404. Explicit list, no pattern. */
export const GONE_PATHS = new Set(["/pt/coming-soon", "/en/coming-soon", "/pt/funcionalidades", "/mo", "/month"]);

/** Missing page: rewrite to a path with no route, so Next renders the not-found page with a real 404 status. */
const notFound = (request: NextRequest, locale: string) =>
  NextResponse.rewrite(new URL(`/${locale}/__not-found`, request.url));

const isPublicPath = (logicalPath: string) =>
  publicPaths.has(logicalPath) ||
  logicalPath.startsWith("/app") ||
  logicalPath === "/docs" ||
  logicalPath.startsWith("/docs/");

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (GONE_PATHS.has(pathname)) {
    return new NextResponse("Gone", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // Detect locale from cookie or path
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const pathLocale = pathname.match(/^\/(en|pt)/)?.[1];
  const locale = pathLocale || cookieLocale || "en";

  // Skip i18n routing for paths outside [locale] (e.g., /login, /api)
  const hasLocalePrefix = /^\/(en|pt)(\/|$)/.test(pathname);
  const isNonLocalePath = !hasLocalePrefix && pathname !== "/";

  // The public API lives on api.corvo.tech; /v1/* on the site is a plain 404, not a redirect to home.
  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return notFound(request, locale);
  }

  if (isNonLocalePath) {
    // Access control only — no i18n routing
    if (process.env.SITE_ACCESS_MODE === "open") {
      return NextResponse.next();
    }
    const logicalPath = pathname.replace(/^\/(en|pt)(\/|$)/, "/") || "/";
    if (isPublicPath(logicalPath)) {
      return NextResponse.next();
    }
    return notFound(request, locale);
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

  // Non-public or unknown paths answer 404 instead of redirecting to home (soft 404).
  return notFound(request, locale);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*$).*)"],
};
