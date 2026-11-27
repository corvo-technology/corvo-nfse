import { SeverityNumber } from "@opentelemetry/api-logs";
import { isIP } from "node:net";
import { after, NextRequest, NextResponse } from "next/server";
import { proxyRoutes } from "@/lib/proxy-routes";
import { loggerProvider, posthogConfigured, posthogLog } from "@/instrumentation";

// Session plus the short-lived social sign-in state cookie.
const sessionNames = new Set(["gf_session_dev", "__Host-gf_session", "gf_oauth_state_dev", "__Host-gf_oauth_state"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const OAUTH_HOSTS = new Set(["accounts.google.com", "github.com"]);

function logProxyOutcome(route: string, method: string, status: number, outcome: "completed" | "body_rejected" | "upstream_unavailable" | "route_unavailable") {
  if (!posthogConfigured) return;
  posthogLog.emit({
    body: outcome === "completed" ? "API proxy request completed" : "API proxy request failed",
    severityNumber: status >= 500 ? SeverityNumber.ERROR : status >= 400 ? SeverityNumber.WARN : SeverityNumber.INFO,
    attributes: {
      event: `api_proxy_request_${outcome}`,
      api_area: route.split("/", 1)[0],
      method,
      status_code: status,
      ...(outcome === "route_unavailable" ? { route } : {}),
    },
  });
  after(async () => {
    await loggerProvider.forceFlush();
  });
}
/** A redirect may only go to a path on this site or to a social provider's consent screen. */
function safeLocation(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value.startsWith("//") || value.includes("\\") ? null : value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OAUTH_HOSTS.has(url.hostname) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
/**
 * Real browser IP for the API's rate limits. Same trust rule as the API: the Cloudflare header only
 * when declared (TRUST_CF_CONNECTING_IP), otherwise the last x-forwarded-for entry added by our own proxy.
 */
function browserIp(request: NextRequest): string | undefined {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (process.env.TRUST_CF_CONNECTING_IP === "true" && cloudflare && isIP(cloudflare)) return cloudflare;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((entry) => entry.trim()).filter((entry) => isIP(entry));
  return forwarded?.at(-1);
}
/** The proxy has no such route: a dashboard call nobody allowed. The code lets the screen say so instead of a generic error. */
function routeUnavailable(route: string, method: string) {
  // Ids stay out of the log: only the shape of the path.
  logProxyOutcome(route.replace(/\/[^/]*\d[^/]*/g, "/:id"), method, 404, "route_unavailable");
  return NextResponse.json({ statusCode: 404, message: "Route unavailable", code: "proxy_route_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
const failure = (status: number, message: string) => NextResponse.json({ statusCode: status, message }, { status, headers: { "Cache-Control": "no-store" } });
async function limitedBody(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  // An empty body must not be forwarded at all: an empty buffer goes out chunked with no content-type, which the API rejects.
  if (size === 0) return undefined;
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
/** A certificate is tiny, a spreadsheet may reach 10 MB (plus the multipart envelope); everything else is JSON. */
function bodyLimit(route: string): number {
  if (/\/certificates$/.test(route)) return 64 * 1024;
  return route === "imports" ? 10 * 1024 * 1024 + 64 * 1024 : 1024 * 1024;
}
async function proxyRequest(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path[0] !== "v1") return failure(404, "Route unavailable");
  try {
    for (const part of path) {
      const decoded = decodeURIComponent(part);
      if (!decoded || decoded === "." || decoded === ".." || /[/\\?#%]/.test(decoded)) return failure(400, "Invalid path");
    }
  } catch { return failure(400, "Invalid path"); }
  const route = path.slice(1).join("/");
  if (!proxyRoutes.some(([pattern, methods]) => pattern.test(route) && methods.includes(request.method))) return routeUnavailable(route, request.method);
  const development = process.env.NODE_ENV !== "production";
  const appOrigin = process.env.APP_ORIGIN ?? (development ? "http://localhost:4000" : undefined);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!appOrigin || request.headers.get("origin") !== appOrigin || (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return failure(403, "Invalid request origin");
  }
  const configured = process.env.API_BASE_URL ?? (development ? "http://localhost:3000" : undefined);
  if (!configured) return failure(503, "API unavailable");
  let backend: URL;
  try {
    backend = new URL(configured);
    if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) return failure(503, "API configuration invalid");
  } catch { return failure(503, "API configuration invalid"); }
  const target = new URL(`/v1/${route}`, backend); target.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ["accept", "content-type", "origin", "sec-fetch-site", "x-csrf-token", "idempotency-key", "x-corvo-environment"]) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  // The API only believes this IP when the shared secret matches; otherwise every visitor looks like this server.
  const proxySecret = process.env.PROXY_SHARED_SECRET; const clientIp = browserIp(request);
  if (proxySecret && clientIp) { headers.set("x-corvo-proxy-secret", proxySecret); headers.set("x-corvo-client-ip", clientIp); }
  // Restrict credentials to session cookies; never proxy Bearer or integration keys.
  const cookie = request.headers.get("cookie")?.split(";").filter((entry) => sessionNames.has(entry.trim().split("=", 1)[0])).map((entry) => entry.trim()).join("; ");
  if (cookie) headers.set("cookie", cookie);
  try {
    const mutation = !["GET", "HEAD"].includes(request.method);
    const body = mutation ? await limitedBody(request, bodyLimit(route)) : undefined;
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    logProxyOutcome(route, request.method, upstream.status, "completed");
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) {
      if (sessionNames.has(cookie.split("=", 1)[0])) responseHeaders.append("Set-Cookie", cookie);
    }
    if (REDIRECT_STATUSES.has(upstream.status)) {
      const location = safeLocation(upstream.headers.get("location"));
      if (!location) return failure(502, "Invalid redirect from the API.");
      responseHeaders.set("Location", location);
      return new NextResponse(null, { status: upstream.status, headers: responseHeaders });
    }
    const noBody = [204, 205, 304].includes(upstream.status);
    return new NextResponse(noBody ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      logProxyOutcome(route, request.method, 413, "body_rejected");
      return failure(413, "Request body too large");
    }
    logProxyOutcome(route, request.method, 502, "upstream_unavailable");
    return failure(502, "Could not connect to the API. Please try again.");
  }
}
export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
