import { randomBytes, timingSafeEqual } from 'node:crypto';

/** How long the user has to finish the provider's consent screen. */
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

const DEFAULT_NEXT = '/app';
/** Same allowlist as the login screen: pages the dashboard may resume after sign-in. */
const ALLOWED_NEXT_PATHS = new Set(['/mcp/authorize', '/accept-invite']);

/** Returns `next` only for an allowed same-site path, otherwise the dashboard. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next.length > 2000) return DEFAULT_NEXT;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return DEFAULT_NEXT;
  }
  try {
    const url = new URL(next, 'http://localhost');
    if (
      url.origin !== 'http://localhost' ||
      !ALLOWED_NEXT_PATHS.has(url.pathname)
    ) {
      return DEFAULT_NEXT;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * `state` goes to the provider; the cookie keeps the same nonce plus where to
 * send the user afterwards. Only the browser that started the flow has the cookie.
 */
export function createOAuthState(next: unknown): {
  state: string;
  cookieValue: string;
} {
  const state = randomBytes(32).toString('base64url');
  const target = Buffer.from(safeNextPath(next)).toString('base64url');
  return { state, cookieValue: `${state}.${target}` };
}

export function readOAuthState(
  cookieValue: string | undefined,
  stateParam: unknown,
): { next: string } | null {
  if (!cookieValue || typeof stateParam !== 'string' || stateParam === '') {
    return null;
  }
  const separator = cookieValue.indexOf('.');
  if (separator <= 0) return null;
  const expected = Buffer.from(cookieValue.slice(0, separator));
  const given = Buffer.from(stateParam);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  const encoded = cookieValue.slice(separator + 1);
  return {
    next: safeNextPath(Buffer.from(encoded, 'base64url').toString('utf8')),
  };
}
