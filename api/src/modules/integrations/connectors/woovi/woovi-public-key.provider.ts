import { Injectable } from '@nestjs/common';
import {
  ConnectorTransientError,
  type IntegrationEnvironment,
} from '../../domain/connector';
import { wooviBaseUrl } from './woovi-hosts';

const TTL_MS = 60 * 60_000;
/** A signature that fails against the cached list may mean a rotation, but nobody should be able to force a fetch per request. */
const MIN_FORCED_REFRESH_MS = 30_000;

interface Cached {
  keys: string[];
  fetchedAt: number;
}

/** Woovi signs every webhook with its own RSA key; the current keys are public. */
@Injectable()
export class WooviPublicKeyProvider {
  private readonly cache = new Map<IntegrationEnvironment, Cached>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getKeys(
    environment: IntegrationEnvironment,
    forceRefresh = false,
  ): Promise<string[]> {
    const cached = this.cache.get(environment);
    const age = cached ? this.now() - cached.fetchedAt : Infinity;
    const fresh = age < TTL_MS;
    if (cached && fresh && (!forceRefresh || age < MIN_FORCED_REFRESH_MS))
      return cached.keys;
    try {
      const response = await this.fetchFn(
        `${wooviBaseUrl(environment)}/api/v1/webhook/public-keys`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok)
        throw new ConnectorTransientError(
          `Woovi public keys answered ${response.status}`,
        );
      const body = (await response.json()) as {
        public_keys?: Array<{ key?: string }>;
      };
      const keys = (body.public_keys ?? []).flatMap((entry) =>
        entry.key ? [entry.key] : [],
      );
      if (keys.length === 0)
        throw new ConnectorTransientError('Woovi published no public keys');
      this.cache.set(environment, { keys, fetchedAt: this.now() });
      return keys;
    } catch (error) {
      // An outage of the key endpoint must not turn real webhooks into rejections.
      if (cached) return cached.keys;
      throw error instanceof ConnectorTransientError
        ? error
        : new ConnectorTransientError('Could not load Woovi public keys');
    }
  }
}
