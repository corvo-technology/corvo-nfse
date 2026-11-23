import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { PUBLISHED_DOC_SLUGS } from "./lib/docs/slugs";
import { SITE_URL } from "./lib/seo";

const handleI18nRouting = createMiddleware(routing);

/** Crawlers and AI agents: they must not get a language cookie that would pin later visits. */
const BOT_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|PerplexityBot|Google-Extended|Applebot/i;

export const isBot = (userAgent: string | null) => Boolean(userAgent && BOT_USER_AGENT.test(userAgent));

/**
 * Old URLs without a locale. Each one moves to the pt page with a single 301.
 * The docs slugs below are the Search Console set from 27/10/2026; later slugs are covered
 * by the docs resolver. `/start` is here because that page only exists with a locale —
 * `/start` itself was a 404.
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
  "/start": "/pt/start",
};

/**
 * Doc slugs that used to be requested and no longer have a page.
 * Empty string means the docs introduction (the quickstart lives there).
 * `credits` was the retired credit-purchase reference; billing replaced it.
 */
const RETIRED_DOC_SLUGS: Record<string, string> = {
  quickstart: "",
  credits: "billing",
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
export const GONE_PATHS = new Set([
  "/coming-soon",
  "/pt/coming-soon",
  "/en/coming-soon",
  "/funcionalidades",
  "/pt/funcionalidades",
  "/en/funcionalidades",
  "/mo",
  "/month",
]);

/** Missing page: rewrite to a path with no route, so Next renders the not-found page with a real 404 status. */
const notFound = (request: NextRequest, locale: string) =>
  NextResponse.rewrite(new URL(`/${locale}/__not-found`, request.url));

const isPublicPath = (logicalPath: string) =>
  publicPaths.has(logicalPath) ||
  logicalPath.startsWith("/app") ||
  logicalPath === "/docs" ||
  logicalPath.startsWith("/docs/") ||
  logicalPath === "/blog" ||
  logicalPath.startsWith("/blog/");

const stripTrailingSlash = (pathname: string) =>
  pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

/** A page we actually serve (after locale redirect), so a slash or apex hit can move there in one hop. */
const servesContent = (pathname: string) => {
  if (pathname === "/" || pathname === "/v1" || pathname.startsWith("/v1/")) return false;
  const logical = pathname.replace(/^\/(en|pt)(\/|$)/, "/") || "/";
  return isPublicPath(logical);
};

/** Published slug, retired alias, or the docs index. Unknown slugs return null (a real 404, not a redirect). */
function docTarget(locale: "en" | "pt", slug: string | undefined): string | null {
  if (!slug) return `/${locale}/docs`;
  if (Object.prototype.hasOwnProperty.call(RETIRED_DOC_SLUGS, slug)) {
    const next = RETIRED_DOC_SLUGS[slug];
    return next ? `/${locale}/docs/${next}` : `/${locale}/docs`;
  }
  if (PUBLISHED_DOC_SLUGS.has(slug)) return `/${locale}/docs/${slug}`;
  return null;
}

const gone = () =>
  new NextResponse("Gone", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * One hop to `pathname` on the request host. An apex request is sent to SITE_URL in the same
 * response, so we never 301 to `https://corvo.tech/...` and then again to www.
 * Query string is kept (canonical tags already omit it). The apex host is not a canonical.
 */
function redirectTo(request: NextRequest, pathname: string, status: 301 | 308) {
  const target = new URL(request.url);
  target.pathname = pathname;
  target.hash = "";
  if (target.hostname === "corvo.tech") {
    const canonical = new URL(SITE_URL);
    target.protocol = canonical.protocol;
    target.hostname = canonical.hostname;
  }
  return NextResponse.redirect(target, status);
}

/** Rewrites a redirect Location that next-intl built on the apex host. */
function retargetApex(request: NextRequest, response: NextResponse) {
  if (request.nextUrl.hostname !== "corvo.tech") return response;
  const location = response.headers.get("location");
  if (!location) return response;
  const target = new URL(location, request.url);
  if (target.hostname !== "corvo.tech") return response;
  const canonical = new URL(SITE_URL);
  target.protocol = canonical.protocol;
  target.hostname = canonical.hostname;
  const redirected = NextResponse.redirect(target, response.status);
  for (const cookie of response.headers.getSetCookie()) redirected.headers.append("set-cookie", cookie);
  return redirected;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const bare = stripTrailingSlash(pathname);
  const onApex = request.nextUrl.hostname === "corvo.tech";

  if (GONE_PATHS.has(bare)) return gone();

  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const pathLocale = bare.match(/^\/(en|pt)/)?.[1];
  const locale = pathLocale || cookieLocale || routing.defaultLocale;

  const send = (target: string, status: 301 | 308) => {
    if (target === pathname && !onApex) return null;
    return redirectTo(request, target, status);
  };

  if (bare === "/signup" || bare === "/en/signup" || bare === "/pt/signup") {
    const explicit = bare.match(/^\/(en|pt)\//)?.[1];
    const response = send(`/${explicit || locale}/start`, 308);
    if (response) return response;
  }

  const legacyTarget = LEGACY_REDIRECTS[bare];
  if (legacyTarget) {
    const response = send(legacyTarget, 301);
    if (response) return response;
  }

  // Unprefixed /docs would otherwise be a next-intl 307. Unknown slugs 404 here instead of
  // 301ing to a URL that does not exist (/docs/quickstart used to land on /pt/docs/quickstart).
  if (bare === "/docs" || bare.startsWith("/docs/")) {
    const parts = bare.slice("/docs".length).split("/").filter(Boolean);
    if (parts.length > 1) return notFound(request, locale);
    const target = docTarget("pt", parts[0]);
    if (!target) return notFound(request, locale);
    const response = send(target, 301);
    if (response) return response;
  }

  const localeDocs = bare.match(/^\/(en|pt)\/docs(?:\/(.*))?$/);
  if (localeDocs) {
    const docLocale = localeDocs[1] as "en" | "pt";
    const parts = localeDocs[2] ? localeDocs[2].split("/").filter(Boolean) : [];
    if (parts.length > 1) return notFound(request, docLocale);
    const target = docTarget(docLocale, parts[0]);
    if (!target) return notFound(request, docLocale);
    const response = send(target, 301);
    if (response) return response;
  }

  // The blog exists in Portuguese only: /blog and /en/blog (with any sub-path) move to /pt/blog with one 301.
  const blogMatch = bare.match(/^(?:\/en)?(\/blog(?:\/.*)?)$/);
  if (blogMatch) return redirectTo(request, `/pt${blogMatch[1]}`, 301);

  // Leftover trailing slash (/terms/ is already handled above). One hop, including to www.
  if (bare !== pathname) {
    if (!servesContent(bare)) return notFound(request, locale);
    return redirectTo(request, bare, 301);
  }

  // Apex request for a URL we serve: 301 straight to www. Cloudflare already does this on the
  // public edge; this covers a request that still reaches the app, without pointing canonicals at the apex.
  if (onApex && servesContent(bare)) return redirectTo(request, bare, 301);

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

  // i18n routing for locale-prefixed paths and root. "/" stays a 307 so Accept-Language is not cached.
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
    return retargetApex(request, response);
  }

  // Strip locale prefix to get the logical path
  const logicalPath = pathname.replace(/^\/(en|pt)(\/|$)/, "/") || "/";

  if (isPublicPath(logicalPath)) {
    return retargetApex(request, response);
  }

  // Non-public or unknown paths answer 404 instead of redirecting to home (soft 404).
  return notFound(request, locale);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*$).*)"],
};
