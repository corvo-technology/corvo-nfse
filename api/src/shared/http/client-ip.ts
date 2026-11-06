import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export type HttpClientIpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

/**
 * Resolves the caller's IP for rate limiting.
 *
 * Forwarded headers are only believed when they come from something we can
 * authenticate or that the operator explicitly declared:
 * - the Corvo web proxy, which proves itself with PROXY_SHARED_SECRET and
 *   sends the real browser IP in `x-corvo-client-ip`;
 * - Cloudflare, only when TRUST_CF_CONNECTING_IP=true (the origin must then
 *   accept traffic from Cloudflare only).
 * Otherwise the last `x-forwarded-for` entry is used: it is the one appended
 * by our own reverse proxy, unlike the first, which the client can choose.
 */
export function resolveClientIp(
  req: HttpClientIpRequest,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const remoteIp = normalizeIp(req.ip);
  if (!remoteIp || !isTrustedProxyIp(remoteIp)) return remoteIp;

  if (isAuthenticatedWebProxy(req, env.PROXY_SHARED_SECRET)) {
    const webClientIp = firstValidIpFromHeader(req, 'x-corvo-client-ip');
    if (webClientIp) return webClientIp;
  }

  if (env.TRUST_CF_CONNECTING_IP === 'true') {
    const cloudflareIp = firstValidIpFromHeader(req, 'cf-connecting-ip');
    if (cloudflareIp) return cloudflareIp;
  }

  return lastValidIpFromHeader(req, 'x-forwarded-for') ?? remoteIp;
}

function isAuthenticatedWebProxy(
  req: HttpClientIpRequest,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const providedSecret = firstHeader(req, 'x-corvo-proxy-secret');
  if (!providedSecret) return false;

  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

function lastValidIpFromHeader(
  req: HttpClientIpRequest,
  name: string,
): string | undefined {
  const value = firstHeader(req, name);
  return value
    ?.split(',')
    .map((entry) => normalizeIp(entry))
    .reverse()
    .find((entry): entry is string => entry !== undefined);
}

function firstValidIpFromHeader(
  req: HttpClientIpRequest,
  name: string,
): string | undefined {
  const value = firstHeader(req, name);
  return value
    ?.split(',')
    .map((entry) => normalizeIp(entry))
    .find((entry): entry is string => entry !== undefined);
}

function firstHeader(
  req: HttpClientIpRequest,
  name: string,
): string | undefined {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIp(value: string | null | undefined): string | undefined {
  const ip = value?.trim();
  if (!ip) return undefined;

  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return isIP(normalized) === 0 ? undefined : normalized;
}

function isTrustedProxyIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;

  const parts = ip.split('.').map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [first, second] = parts;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }

  const lowerIp = ip.toLowerCase();
  return lowerIp.startsWith('fc') || lowerIp.startsWith('fd');
}
