import { createHash } from 'node:crypto';
import { parsePfx } from 'open-nfse';
import { ProxyAgent, type Dispatcher } from 'undici';

/** Hosts the NFS-e client talks to (sefin/adn, production and restricted). Only these may use the proxy. */
export function isGovNfseHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'nfse.gov.br' || h.endsWith('.nfse.gov.br');
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

const MAX_CACHED = 32;

/** CONNECT-tunnel agent. The client key/cert live in `requestTls`: mTLS stays end-to-end through the proxy. */
export function buildGovProxyAgent(
  proxyUrl: string,
  pem: { keyPem: string; certPem: string },
  extraTls: { ca?: string } = {},
): ProxyAgent {
  return new ProxyAgent({
    uri: proxyUrl,
    requestTls: {
      key: pem.keyPem,
      cert: pem.certPem,
      // The Sefin rejects HTTP/2 on authenticated paths (same as the open-nfse default).
      ALPNProtocols: ['http/1.1'],
      ...extraTls,
    },
  });
}

/**
 * Builds undici `ProxyAgent`s (HTTP CONNECT tunnel) for the government calls. The client certificate
 * goes in `requestTls`, so the TLS session (mTLS) is end-to-end between us and the Sefin and the proxy
 * only sees an encrypted tunnel. One agent per certificate is cached, so sockets are reused and not leaked.
 */
export class GovProxyDispatchers {
  private readonly cache = new Map<string, ProxyAgent>();

  constructor(private readonly proxyUrl: string) {}

  for(pfx: Buffer, password: string): Dispatcher {
    const id = createHash('sha256')
      .update(pfx)
      .update('\0')
      .update(password)
      .digest('hex');
    const hit = this.cache.get(id);
    if (hit) {
      this.cache.delete(id);
      this.cache.set(id, hit);
      return hit;
    }
    const agent = buildGovProxyAgent(this.proxyUrl, parsePfx(pfx, password));
    this.cache.set(id, agent);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value as string;
      const evicted = this.cache.get(oldest);
      this.cache.delete(oldest);
      void evicted?.close().catch(() => undefined);
    }
    return agent;
  }
}
