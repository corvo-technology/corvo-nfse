import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Dispatcher } from 'undici';
import {
  GovProxyDispatchers,
  certificateCacheKey,
  isGovFiscalHost,
  redactProxyUrl,
  type ClientPem,
} from '@/infra/external/fiscal-proxy/gov-proxy';
import { PortalReachabilityStore } from './reachability.store';

const CACHE_MS = 15_000;

/** Which way the government calls go: direct (always, by default) or through the backup proxy. */
@Injectable()
export class GovRouteSelector {
  private readonly logger = new Logger(GovRouteSelector.name);
  private readonly proxyUrl?: string;
  private readonly dispatchers?: GovProxyDispatchers;
  private cached?: { at: number; value: boolean };
  private announced = false;

  constructor(
    config: ConfigService,
    private readonly store: PortalReachabilityStore,
  ) {
    this.proxyUrl = config.get<string>('FISCAL_HTTPS_PROXY') || undefined;
    if (this.proxyUrl)
      this.dispatchers = new GovProxyDispatchers(this.proxyUrl);
  }

  /** True when the backup proxy is configured. */
  get configured(): boolean {
    return this.proxyUrl !== undefined;
  }

  /**
   * The proxy is used only while the proxy is configured AND the monitor says our network cannot reach
   * the government (`gov_unreachable_from_us`). Any doubt (Redis error) means the direct route. The answer
   * is cached for 15 s. The monitor's own probes never use the proxy, so they measure the direct route and
   * that is what brings us back by themselves.
   */
  async useProxy(): Promise<boolean> {
    if (!this.proxyUrl) return false;
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS)
      return this.cached.value;
    let value = false;
    try {
      value = (await this.store.current()).state === 'gov_unreachable_from_us';
    } catch {
      value = false;
    }
    this.cached = { at: now, value };
    if (value !== this.announced) {
      this.announced = value;
      const where = redactProxyUrl(this.proxyUrl);
      if (value) this.logger.warn(`Government calls now go through ${where}`);
      else this.logger.log(`Government calls go direct again (${where})`);
    }
    return value;
  }

  /**
   * The dispatcher for a call to `host`, or `undefined` for the direct route: no proxy needed right now,
   * or the host is not on the exact government allowlist.
   */
  async dispatcherFor(
    host: string,
    scope: 'nfse' | 'sefaz',
    pem: ClientPem,
    ca?: string | string[],
  ): Promise<Dispatcher | undefined> {
    if (!this.dispatchers || !isGovFiscalHost(host)) return undefined;
    if (!(await this.useProxy())) return undefined;
    return this.dispatchers.for(
      certificateCacheKey(scope, pem.certPem),
      pem,
      ca,
    );
  }
}
