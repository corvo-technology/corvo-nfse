/** Pages the login screen may send the user back to (never an arbitrary URL). */
const ALLOWED_NEXT_PATHS = new Set(["/mcp/authorize", "/accept-invite"]);

/** Returns `next` only when it is a same-site path on the allowlist, else null. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  try {
    const url = new URL(next, "http://localhost");
    if (url.origin !== "http://localhost" || !ALLOWED_NEXT_PATHS.has(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
