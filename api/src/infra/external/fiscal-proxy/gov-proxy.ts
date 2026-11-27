import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ProxyAgent, type Dispatcher } from 'undici';
import {
  ENDPOINTS,
  ENDPOINTS_65,
  ENDPOINTS_SVC,
} from '@/infra/external/nfe/sefaz/endpoints';

/**
 * Hosts of the NFS-e Nacional client (`open-nfse`): Sefin and ADN, production and restricted production.
 * Written out in full on purpose: a suffix rule like `*.gov.br` would let the proxy reach anything.
 */
export const NFSE_GOV_HOSTS: readonly string[] = [
  'sefin.nfse.gov.br',
  'adn.nfse.gov.br',
  'sefin.producaorestrita.nfse.gov.br',
  'adn.producaorestrita.nfse.gov.br',
];

/** Every government host the backup route may reach: NFS-e plus each SEFAZ/SVC host of the endpoint tables. */
export const GOV_FISCAL_HOSTS: ReadonlySet<string> = new Set([
  ...NFSE_GOV_HOSTS,
  ...[...ENDPOINTS, ...ENDPOINTS_65, ...ENDPOINTS_SVC].map((row) =>
    new URL(row.url).hostname.toLowerCase(),
  ),
]);

/** Exact match on the host name (never a suffix or a prefix). */
export function isGovFiscalHost(host: string): boolean {
  return GOV_FISCAL_HOSTS.has(host.toLowerCase());
}

/** `http://user:pass@host:port` -> `http://***@host:port`. Safe to log. */
export function redactProxyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.username || u.password ? '***@' : ''}${u.host}`;
  } catch {
    return '[invalid proxy url]';
  }
}

export interface ClientPem {
  keyPem: string;
  certPem: string;
}

const MAX_CACHED = 32;

/**
 * CONNECT-tunnel agent. The client key/cert live in `requestTls`, so the TLS session (mTLS) is end to
 * end between us and the government: the proxy only carries encrypted bytes. The server certificate is
 * always verified (`ca` adds trust roots; it never turns verification off).
 */
export function buildGovProxyAgent(
  proxyUrl: string,
  pem: ClientPem,
  ca?: string | string[],
): ProxyAgent {
  return new ProxyAgent({
    uri: proxyUrl,
    requestTls: {
      key: pem.keyPem,
      cert: pem.certPem,
      // The Sefin rejects HTTP/2 on authenticated paths (same as the open-nfse default).
      ALPNProtocols: ['http/1.1'],
      ...(ca ? { ca } : {}),
    },
  });
}

/** A short id of a certificate, to key the agent cache without keeping the certificate around. */
export function certificateCacheKey(scope: string, certPem: string): string {
  return `${scope}:${createHash('sha256').update(certPem).digest('hex')}`;
}

/** One `ProxyAgent` per key (LRU of 32): sockets are reused and old agents are closed, not leaked. */
export class GovProxyDispatchers {
  private readonly cache = new Map<string, ProxyAgent>();

  constructor(private readonly proxyUrl: string) {}

  for(key: string, pem: ClientPem, ca?: string | string[]): Dispatcher {
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const agent = buildGovProxyAgent(this.proxyUrl, pem, ca);
    this.cache.set(key, agent);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value as string;
      const evicted = this.cache.get(oldest);
      this.cache.delete(oldest);
      void evicted?.close().catch(() => undefined);
    }
    return agent;
  }
}

/**
 * Opens (and immediately closes) a CONNECT tunnel to `host:443` through the proxy: proves the backup
 * route works. No certificate and no payload are sent. Never throws; only allowlisted hosts are tried.
 */
export function probeViaProxy(
  proxyUrl: string,
  host: string,
  timeoutMs = 8_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isGovFiscalHost(host)) return resolve(false);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    try {
      const proxy = new URL(proxyUrl);
      const send = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
      const headers: Record<string, string> = { host: `${host}:443` };
      if (proxy.username || proxy.password)
        headers['proxy-authorization'] = `Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
        ).toString('base64')}`;
      const req = send({
        host: proxy.hostname,
        port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
        method: 'CONNECT',
        path: `${host}:443`,
        headers,
        timeout: timeoutMs,
      });
      req.once('connect', (response, socket) => {
        socket.destroy();
        finish(response.statusCode === 200);
      });
      req.once('response', (response) => {
        response.resume();
        finish(false);
      });
      req.once('timeout', () => {
        req.destroy();
        finish(false);
      });
      req.once('error', () => finish(false));
      req.end();
    } catch {
      finish(false);
    }
  });
}
