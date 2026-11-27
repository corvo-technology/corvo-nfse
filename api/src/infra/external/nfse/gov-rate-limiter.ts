import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { HttpStatusError } from 'open-nfse';
import type { GovRateLimitConfig } from '@/infra/config/configuration.types';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { PortalUnavailableError } from '@/modules/invoice/application/fiscal-portal-breaker';

const DEFAULTS: GovRateLimitConfig = {
  perSecond: 5,
  burst: 10,
  maxWaitMs: 10_000,
};
/** Pause when the portal says 429 without a usable Retry-After. */
const DEFAULT_PAUSE_MS = 30_000;
/** A Retry-After longer than this is capped: one wrong header must not stop emission for hours. */
const MAX_PAUSE_MS = 10 * 60_000;
const MIN_SLEEP_MS = 20;
const MAX_SLEEP_MS = 500;
/** When we gave up waiting, the job tries again after at least this long. */
const MIN_RETRY_MS = 2_000;

/**
 * Token bucket in one atomic step, so every replica draws from the same bucket.
 * Returns {1, 0} when a token was taken, {0, ms} when the caller should wait `ms`,
 * and {2, ms} while the host is paused (a 429 / 503 with Retry-After was seen).
 */
const TAKE_TOKEN_SCRIPT = `
local pause = redis.call('PTTL', KEYS[2])
if pause > 0 then return {2, pause} end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local h = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(h[1])
local ts = tonumber(h[2])
if tokens == nil or ts == nil then
  tokens = burst
  ts = now
end
tokens = math.min(burst, tokens + math.max(0, now - ts) * rate / 1000)
local granted = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
else
  wait = math.ceil((1 - tokens) * 1000 / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(burst * 1000 / rate) + 1000)
return {granted, wait}
`;

/**
 * Global brake on calls to government hosts (one bucket per host key, e.g. `sefin:production`),
 * shared by every replica through Redis. Callers wait a little for a token; when none comes in
 * time, or the host is paused, they get a `PortalUnavailableError` so the job is delayed
 * without spending an attempt and without counting as a portal outage.
 * If Redis is down the limiter lets the call through: our own brake never blocks emission.
 */
@Injectable()
export class GovRateLimiter {
  private readonly logger = new Logger(GovRateLimiter.name);
  readonly settings: GovRateLimitConfig;
  private redisDownLogged = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() config?: ConfigService,
  ) {
    this.settings = {
      ...DEFAULTS,
      ...config?.get<GovRateLimitConfig>('govRateLimit'),
    };
  }

  private bucketKey(host: string): string {
    return `gov:bucket:${host}`;
  }

  private pauseKey(host: string): string {
    return `gov:pause:${host}`;
  }

  /** Waits for a token of `host`. Throws `PortalUnavailableError` when it cannot get one in time. */
  async acquire(host: string): Promise<void> {
    const deadline = Date.now() + this.settings.maxWaitMs;
    for (;;) {
      let granted: number;
      let waitMs: number;
      try {
        const reply = (await this.redis.eval(
          TAKE_TOKEN_SCRIPT,
          2,
          this.bucketKey(host),
          this.pauseKey(host),
          this.settings.perSecond,
          this.settings.burst,
        )) as [number, number];
        [granted, waitMs] = [Number(reply[0]), Number(reply[1])];
        this.redisDownLogged = false;
      } catch (error) {
        if (!this.redisDownLogged) {
          this.redisDownLogged = true;
          this.logger.warn(
            `Redis unavailable: government rate limit is off until it returns (${error instanceof Error ? error.name : 'error'})`,
          );
        }
        return;
      }
      if (granted === 1) return;
      const now = Date.now();
      if (now + waitMs > deadline) {
        // Too long to wait here: hand the job back (a pause tells exactly when it ends).
        const retryMs = granted === 2 ? waitMs : Math.max(waitMs, MIN_RETRY_MS);
        throw new PortalUnavailableError(new Date(now + retryMs));
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, waitMs)),
        ),
      );
    }
  }

  /** Stops every replica from calling `host` for `ms`. */
  async pause(host: string, ms: number): Promise<void> {
    const ttl = Math.min(Math.max(Math.ceil(ms), 1_000), MAX_PAUSE_MS);
    try {
      await this.redis.set(this.pauseKey(host), String(Date.now()), 'PX', ttl);
    } catch {
      // Redis is down: nothing to share the pause with.
    }
    this.logger.warn(`Calls to ${host} paused for ${ttl} ms by the portal`);
  }

  /** A 429 (or a 503 with Retry-After) from the portal pauses the host; any other error is ignored. */
  async noteError(host: string, error: unknown): Promise<void> {
    if (!(error instanceof HttpStatusError)) return;
    const retryAfter = error.getRetryAfterMs();
    if (error.status === 429) {
      await this.pause(host, retryAfter ?? DEFAULT_PAUSE_MS);
    } else if (
      error.status === 503 &&
      retryAfter !== undefined &&
      retryAfter > 0
    ) {
      await this.pause(host, retryAfter);
    }
  }
}
