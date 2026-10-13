import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { WebhookValidationError } from '../domain/errors';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

const PRIVATE_RANGES_V4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local + cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
];

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const num =
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    return PRIVATE_RANGES_V4.some(([start, end]) => num >= start && num <= end);
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    const mapped = lower.match(/^::ffff:([0-9.]+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80:')) return true; // link-local
    return false;
  }
  return false;
}

export async function assertNotPrivateHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new WebhookValidationError(
      'Webhook URL must not resolve to a private network address',
      { host },
    );
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new WebhookValidationError(
        'Webhook URL must not point to a private network address',
        { host },
      );
    }
    return;
  }

  try {
    const records = await lookup(host, { all: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new WebhookValidationError(
          `Webhook URL hostname ${host} resolves to a private address`,
          { host, resolvedAddress: record.address },
        );
      }
    }
  } catch (error) {
    if (error instanceof WebhookValidationError) throw error;
    throw new WebhookValidationError(
      `Cannot resolve webhook hostname ${host}`,
      { host },
    );
  }
}
