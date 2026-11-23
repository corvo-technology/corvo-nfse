import { cookies } from "next/headers";

// Same names the proxy forwards (web/app/api/proxy/[...path]/route.ts).
const SESSION_COOKIES = ["gf_session_dev", "__Host-gf_session"];

/**
 * Asks the API whether the current cookie session belongs to a platform admin.
 * Any failure (no cookie, network, non-200, odd body) means "not admin".
 */
export async function isPlatformAdminOnServer(): Promise<boolean> {
  try {
    const store = await cookies();
    const cookie = store
      .getAll()
      .filter((entry) => SESSION_COOKIES.includes(entry.name))
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
    if (!cookie) return false;
    const base = process.env.API_BASE_URL ?? (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);
    if (!base) return false;
    const response = await fetch(new URL("/v1/auth/session", base), {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { isPlatformAdmin?: unknown } };
    return body?.data?.isPlatformAdmin === true;
  } catch {
    return false;
  }
}
