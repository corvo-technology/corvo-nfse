import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '@/infra/config/configuration';
import { CacheOptions, CachePort } from './cache.port';
import { deleteRedisKeysByPattern } from './redis-cache.helpers';
import { REDIS_CLIENT } from './redis.constants';
import { assertPositiveInteger, buildRedisKey } from './redis-key.util';

@Injectable()
export class RedisCacheService implements CachePort {
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    const config = configService.getOrThrow<RedisConfig>('redis');
    this.keyPrefix = config.keyPrefix;
    this.defaultTtlSeconds = config.cacheDefaultTtlSeconds;
  }
  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(
      buildRedisKey(this.keyPrefix, 'cache', key),
    );
    return value === null ? null : (JSON.parse(value) as T);
  }
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const ttlSeconds = options?.ttlSeconds ?? this.defaultTtlSeconds;
    assertPositiveInteger(ttlSeconds, 'ttlSeconds');
    await this.redis.set(
      buildRedisKey(this.keyPrefix, 'cache', key),
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }
  async delete(key: string): Promise<void> {
    await this.redis.del(buildRedisKey(this.keyPrefix, 'cache', key));
  }
  deleteByPattern(pattern: string): Promise<number> {
    return deleteRedisKeysByPattern(this.redis, this.keyPrefix, pattern);
  }
  async remember<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, options);
    return value;
  }
}
