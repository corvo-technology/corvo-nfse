import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/** Crawlers and AI agents: they must not get a language cookie that would pin later visits. */
const BOT_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|PerplexityBot|Google-Extended|Applebot/i;

export const isBot = (userAgent: string | null) => Boolean(userAgent && BOT_USER_AGENT.test(userAgent));

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
  "/accept-invite",
  "/docs",
  "/api-docs",
  "/brand",
  "/dpa",
  "/privacy",
  "/security",
  "/start",
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

  const legacyTarget = LEGACY_REDIRECTS[pathname];
  if (legacyTarget) {
    return NextResponse.redirect(new URL(legacyTarget, request.url), 301);
  }

  // Any other /docs URL without locale (e.g. /docs, /docs/quickstart): one 301 to the pt page,
  // keeping path and query. Runs before next-intl, which would answer /docs with a 307.
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    const target = new URL(request.url);
    target.pathname = `/pt${pathname}`;
    return NextResponse.redirect(target, 301);
  }

  // Detect locale from cookie or path
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const pathLocale = pathname.match(/^\/(en|pt)/)?.[1];
  const locale = pathLocale || cookieLocale || routing.defaultLocale;

  // Signup intent from ads and links lands on the indexable start page.
  if (pathname === "/signup" || pathname === `/${pathLocale}/signup`) {
    return NextResponse.redirect(new URL(`/${locale}/start`, request.url), 308);
  }

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
  if (isBot(request.headers.get("user-agent"))) {
    response.headers.delete("set-cookie");
  }

  // Locale-prefixed pages are static and cached by the CDN: a Set-Cookie would make them
  // uncacheable. The URL already carries the locale; the root redirect and the locale
  // switcher still set NEXT_LOCALE.
  if (hasLocalePrefix) response.headers.delete("set-cookie");

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
