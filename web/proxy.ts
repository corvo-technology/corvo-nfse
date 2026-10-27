import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/** Crawlers and AI agents: they must not get a language cookie that would pin later visits. */
const BOT_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|PerplexityBot|Google-Extended|Applebot/i;

export const isBot = (userAgent: string | null) => Boolean(userAgent && BOT_USER_AGENT.test(userAgent));

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

  // Detect locale from cookie or path
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const pathLocale = pathname.match(/^\/(en|pt)/)?.[1];
  const locale = pathLocale || cookieLocale || routing.defaultLocale;

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

  // Redirect non-public paths to home in the same locale
  return NextResponse.redirect(new URL(`/${locale}`, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*$).*)"],
};
