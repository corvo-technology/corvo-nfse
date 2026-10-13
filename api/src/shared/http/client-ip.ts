import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export type HttpClientIpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

export type ClientIpResolutionOptions = {
  bookingProxySecret?: string;
};

export function resolveClientIp(
  req: HttpClientIpRequest,
  options: ClientIpResolutionOptions = {},
): string | undefined {
  if (isAuthenticatedBookingProxy(req, options.bookingProxySecret)) {
    const bookingClientIp = firstValidIpFromHeader(
      req,
      'x-greenflow-client-ip',
    );
    if (bookingClientIp) return bookingClientIp;
  }

  const remoteIp = normalizeIp(req.ip);

  if (remoteIp && isTrustedProxyIp(remoteIp)) {
    return (
      firstValidIpFromHeader(req, 'cf-connecting-ip') ??
      firstValidIpFromHeader(req, 'x-forwarded-for') ??
      remoteIp
    );
  }

  return remoteIp;
}

function isAuthenticatedBookingProxy(
  req: HttpClientIpRequest,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const providedSecret = firstHeader(req, 'x-greenflow-booking-proxy-secret');
  if (!providedSecret) return false;

  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
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
