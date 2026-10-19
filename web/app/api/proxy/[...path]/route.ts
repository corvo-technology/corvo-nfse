import { NextRequest, NextResponse } from "next/server";

const routes: [RegExp, string[]][] = [
  [/^auth\/magic-link\/(request|verify)$/, ["POST"]],
  [/^auth\/session$/, ["GET"]],
  [/^auth\/oauth\/providers$/, ["GET"]],
  [/^auth\/oauth\/(google|github)\/(authorize|callback)$/, ["GET"]],
  [/^auth\/session\/(logout|tenant)$/, ["POST"]],
  [/^auth\/(me|memberships|permissions|members)$/, ["GET"]],
  [/^auth\/invite$/, ["POST"]],
  [/^auth\/members\/[^/]+$/, ["DELETE"]],
  [/^auth\/api-keys$/, ["GET", "POST"]],
  [/^auth\/api-keys\/[^/]+$/, ["DELETE"]],
  [/^plans(?:\/[^/]+)?$/, ["GET"]],
  [/^billing\/(plan|usage)$/, ["GET"]],
  [/^billing\/checkout$/, ["POST"]],
  [/^billing\/checkout\/[^/]+$/, ["GET"]],
  [/^billing\/(portal|upgrade|downgrade)$/, ["POST"]],
  [/^credits(?:\/(plans|history))?$/, ["GET"]],
  [/^credits\/purchase\/preview$/, ["POST"]],
  [/^companies$/, ["GET", "POST"]],
  [/^companies\/[^/]+$/, ["GET", "PATCH", "DELETE"]],
  [/^companies\/[^/]+\/certificates$/, ["GET", "POST"]],
  [/^companies\/[^/]+\/certificates\/[^/]+$/, ["DELETE"]],
  [/^companies\/[^/]+\/fiscal-profile$/, ["GET", "PUT"]],
  [/^companies\/[^/]+\/fiscal-profile\/[^/]+\/approve$/, ["POST"]],
  [/^companies\/[^/]+\/service-tax-profiles$/, ["GET", "POST"]],
  [/^companies\/[^/]+\/service-tax-profiles\/[^/]+$/, ["PATCH"]],
  [/^companies\/[^/]+\/service-tax-profiles\/[^/]+\/approve$/, ["POST"]],
  [/^invoices$/, ["GET", "POST"]],
  [/^invoices\/calculate$/, ["POST"]],
  [/^invoices\/[^/]+(?:\/(events|pdf|xml))?$/, ["GET"]],
  [/^invoices\/[^/]+\/download-url$/, ["POST"]],
  [/^invoices\/[^/]+\/email$/, ["POST"]],
  [/^webhooks$/, ["GET", "POST"]],
  [/^webhooks\/deliveries(?:\/stats)?$/, ["GET"]],
  [/^webhooks\/deliveries\/[^/]+\/retry$/, ["POST"]],
  [/^webhooks\/[^/]+\/test$/, ["POST"]],
  [/^webhooks\/[^/]+$/, ["DELETE"]],
  [/^mcp\/consent$/, ["GET", "POST"]],
  [/^mcp\/connections$/, ["GET"]],
  [/^mcp\/connections\/[^/]+$/, ["DELETE"]],
  [/^public\/security\/turnstile\/verify$/, ["POST"]],
  [/^health\/(live|ready)$/, ["GET"]],
];
// Session, the short-lived social sign-in state cookie and the single-use Turnstile proof.
const sessionNames = new Set(["gf_session_dev", "__Host-gf_session", "gf_oauth_state_dev", "__Host-gf_oauth_state", "gf_human_login_dev", "__Host-gf_human_login"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const OAUTH_HOSTS = new Set(["accounts.google.com", "github.com"]);
/** A redirect may only go to a path on this site or to a social provider's consent screen. */
function safeLocation(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value.startsWith("//") || value.includes("\\") ? null : value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OAUTH_HOSTS.has(url.hostname) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
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
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
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
  if (!routes.some(([pattern, methods]) => pattern.test(route) && methods.includes(request.method))) return failure(404, "Route unavailable");
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
  // Restrict credentials to session cookies; never proxy Bearer or integration keys.
  const cookie = request.headers.get("cookie")?.split(";").filter((entry) => sessionNames.has(entry.trim().split("=", 1)[0])).map((entry) => entry.trim()).join("; ");
  if (cookie) headers.set("cookie", cookie);
  try {
    const mutation = !["GET", "HEAD"].includes(request.method);
    const body = mutation ? await limitedBody(request, /\/certificates$/.test(route) ? 64 * 1024 : 1024 * 1024) : undefined;
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
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
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return failure(413, "Request body too large");
    return failure(502, "Could not connect to the API. Please try again.");
  }
}
export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
