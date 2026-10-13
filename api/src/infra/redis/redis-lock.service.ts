import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '@/infra/config/configuration';
import {
  AcquiredLock,
  LockOptions,
  LockPort,
  RenewingLockOptions,
} from './lock.port';
import { REDIS_CLIENT } from './redis.constants';
import { extendRedisLock, releaseRedisLock } from './redis-lock.helpers';
import { assertPositiveInteger, buildRedisKey } from './redis-key.util';

@Injectable()
export class RedisLockService implements LockPort {
  private readonly keyPrefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.keyPrefix = configService.getOrThrow<RedisConfig>('redis').keyPrefix;
  }
  async acquire(
    key: string,
    options: LockOptions,
  ): Promise<AcquiredLock | null> {
    assertPositiveInteger(options.ttlMs, 'ttlMs');
    const token = randomUUID();
    const acquired = await this.redis.set(
      buildRedisKey(this.keyPrefix, 'lock', key),
      token,
      'PX',
      options.ttlMs,
      'NX',
    );

    return acquired === 'OK' ? { key, token, ttlMs: options.ttlMs } : null;
  }
  release(lock: AcquiredLock): Promise<boolean> {
    return releaseRedisLock(this.redis, this.keyPrefix, lock);
  }
  extend(lock: AcquiredLock, ttlMs = lock.ttlMs): Promise<boolean> {
    assertPositiveInteger(ttlMs, 'ttlMs');
    return extendRedisLock(this.redis, this.keyPrefix, lock, ttlMs);
  }
  async withLock<T>(
    key: string,
    options: LockOptions,
    callback: () => Promise<T>,
  ): Promise<T> {
    const lock = await this.acquireWithTimeout(key, options);
    if (lock === null) throw new Error(`Could not acquire lock: ${key}`);
    try {
      return await callback();
    } finally {
      await this.release(lock);
    }
  }

  async withRenewingLock<T>(
    key: string,
    options: RenewingLockOptions,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    assertPositiveInteger(options.renewIntervalMs, 'renewIntervalMs');
    if (options.renewIntervalMs >= options.ttlMs) {
      throw new Error('renewIntervalMs must be less than ttlMs');
    }
    const lock = await this.acquireWithTimeout(key, options);
    if (!lock) throw new Error(`Could not acquire lock: ${key}`);

    const abort = new AbortController();
    let renewalError: Error | undefined;
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing || renewalError) return;
      renewing = true;
      void this.extend(lock)
        .then((extended) => {
          if (extended) return;
          renewalError = new Error(`Lost lock ownership: ${key}`);
          abort.abort(renewalError);
        })
        .catch((error: unknown) => {
          renewalError =
            error instanceof Error ? error : new Error(String(error));
          abort.abort(renewalError);
        })
        .finally(() => {
          renewing = false;
        });
    }, options.renewIntervalMs);
    timer.unref();

    try {
      const result = await callback(abort.signal);
      if (renewalError) throw renewalError;
      return result;
    } finally {
      clearInterval(timer);
      await this.release(lock);
    }
  }

  private async acquireWithTimeout(
    key: string,
    options: LockOptions & { acquireTimeoutMs?: number },
  ): Promise<AcquiredLock | null> {
    const timeoutMs = options.acquireTimeoutMs ?? 0;
    const deadline = Date.now() + timeoutMs;
    do {
      const lock = await this.acquire(key, options);
      if (lock) return lock;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(100, deadline - Date.now()));
        timer.unref();
      });
    } while (Date.now() < deadline);
    return null;
  }
}
