import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import {
  NFE_RELEASE_READER,
  type NfeReleaseReader,
} from '../domain/nfe-release.reader';

const CACHE_TTL_SECONDS = 60;

/** NF-e is visible only with the global NFE_ENABLED and the tenant's own release. */
@Injectable()
export class NfeAccessPolicy {
  constructor(
    private readonly config: ConfigService,
    @Inject(NFE_RELEASE_READER) private readonly release: NfeReleaseReader,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    if (this.config.get<boolean>('NFE_ENABLED') !== true) return false;
    const key = `nfe:enabled:${tenantId}`;
    const cached = await this.cache.get<boolean>(key);
    if (typeof cached === 'boolean') return cached;
    const enabled = (await this.release.releasedAt(tenantId)) !== null;
    await this.cache.set(key, enabled, { ttlSeconds: CACHE_TTL_SECONDS });
    return enabled;
  }
}
