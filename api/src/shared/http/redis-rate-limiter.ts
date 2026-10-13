import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@/infra/redis/redis.service';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

@Injectable()
export class RedisRateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);

  private readonly fallback = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private redisUnavailableUntil = 0;
  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async check(
    key: string,
    config: RateLimitConfig,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const windowStart = now - (now % config.windowMs);
    const prefix = this.config?.get<string>('redis.keyPrefix') ?? 'corvo';
    const redisKey = `${prefix}:ratelimit:${key}:${windowStart}`;

    let current: number;
    try {
      if (this.redisUnavailableUntil > now)
        throw new Error('Rate limiter circuit is open');
      const client = this.redis.getClient();
      const operation = client.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return n",
        1,
        redisKey,
        config.windowMs,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        current = Number(
          await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Rate limiter timed out')),
                250,
              );
            }),
          ]),
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      if (this.redisUnavailableUntil <= now) {
        this.logger.warn({
          event: 'rate_limiter_local_fallback',
          message:
            'Redis rate limiter unavailable; using bounded per-process counters',
        });
        this.redisUnavailableUntil = now + 5000;
      }
      for (const [entryKey, entry] of this.fallback)
        if (entry.resetAt <= now) this.fallback.delete(entryKey);
      if (!this.fallback.has(redisKey) && this.fallback.size >= 10000) {
        // Preserve a bounded aggregate counter rather than evicting active identities.
        const overflow = `overflow:${windowStart}`;
        const entry = this.fallback.get(overflow) ?? {
          count: 0,
          resetAt: windowStart + config.windowMs,
        };
        current = ++entry.count;
        this.fallback.set(overflow, entry);
      } else {
        const entry = this.fallback.get(redisKey) ?? {
          count: 0,
          resetAt: windowStart + config.windowMs,
        };
        current = ++entry.count;
        this.fallback.set(redisKey, entry);
      }
    }

    const remaining = Math.max(0, config.max - current);
    const resetAt = windowStart + config.windowMs;

    return {
      allowed: current <= config.max,
      remaining,
      resetAt,
    };
  }

  /**
   * Increments a counter key by 1 and sets the TTL on first increment.
   * Returns the current count after incrementing.
   * @param key The Redis key to increment
   * @param ttlSeconds Time-to-live in seconds for the key
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ttlSeconds);
    }
    return count;
  }
}
