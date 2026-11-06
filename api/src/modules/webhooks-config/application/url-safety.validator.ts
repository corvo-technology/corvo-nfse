import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { LookupOptions } from 'node:dns';
import { WebhookValidationError } from '../domain/errors';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

// Everything a webhook must never reach: private, loopback, link-local/metadata, CGNAT, benchmarking,
// multicast/reserved, and the IPv6 forms that embed or translate IPv4 (NAT64, 6to4).
// IPv4-mapped IPv6 (::ffff:a.b.c.d, in dotted or hex form) is checked against the IPv4 rules by BlockList.
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback and IPv4-compatible
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['2002::', 16], // 6to4
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  return BLOCKED.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * DNS lookup for outbound webhook connections. It runs at connect time, so the address that is
 * validated is the address that is used (a hostname cannot answer "public" at registration and
 * "internal" at delivery).
 */
export function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses;
    const blocked = list.find((entry) => isPrivateIp(entry.address));
    if (blocked || list.length === 0) {
      return callback(
        new WebhookValidationError(
          `Webhook hostname ${hostname} resolves to a private address`,
          { host: hostname },
        ),
        '',
        0,
      );
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
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
