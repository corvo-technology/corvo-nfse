import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import {
  NFE_RELEASE_READER,
  type NfeReleaseReader,
} from '../domain/nfe-release.reader';

const CACHE_TTL_SECONDS = 60;

/**
 * NF-e and NFC-e are visible only with the global NFE_ENABLED and the tenant's own release
 * (`nfe_enabled_at` / `nfce_enabled_at`). The NFC-e has no env of its own.
 */
@Injectable()
export class NfeAccessPolicy {
  constructor(
    private readonly config: ConfigService,
    @Inject(NFE_RELEASE_READER) private readonly release: NfeReleaseReader,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  async isEnabled(
    tenantId: string,
    type: 'nfe' | 'nfce' = 'nfe',
  ): Promise<boolean> {
    if (this.config.get<boolean>('NFE_ENABLED') !== true) return false;
    const key = `${type}:enabled:${tenantId}`;
    const cached = await this.cache.get<boolean>(key);
    if (typeof cached === 'boolean') return cached;
    const enabled = (await this.release.releasedAt(tenantId, type)) !== null;
    await this.cache.set(key, enabled, { ttlSeconds: CACHE_TTL_SECONDS });
    return enabled;
  }
}
