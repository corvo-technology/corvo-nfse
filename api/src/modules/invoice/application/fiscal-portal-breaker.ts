import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import {
  NetworkError,
  ServerError,
  TimeoutError,
  TooManyRequestsError,
} from 'open-nfse';
import type { FiscalPortalConfig } from '@/infra/config/configuration.types';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

const DEFAULTS: FiscalPortalConfig = {
  breakerThreshold: 5,
  breakerCooldownMs: 300_000,
  uncertainMaxHours: 6,
};
/** Failures older than this no longer count towards opening the breaker. */
const FAILURE_WINDOW_MS = 15 * 60_000;
/** Failures are also counted per minute, so the ops alert can ask "how many in the last N minutes". */
const MINUTE_MS = 60_000;
const BUCKET_TTL_MS = 20 * MINUTE_MS;

/**
 * True only when the portal really did not answer (timeout, connection error, 5xx, 429).
 * An answer such as HTTP 400, a rejection or our own bug is not an outage and must not open the breaker.
 */
export function isPortalOutage(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    error instanceof TimeoutError ||
    error instanceof ServerError ||
    error instanceof TooManyRequestsError
  );
}

/** The portal is paused: the job waits until `retryAt` without spending an attempt. */
export class PortalUnavailableError extends Error {
  constructor(readonly retryAt: Date) {
    super(`Fiscal portal unavailable until ${retryAt.toISOString()}`);
    this.name = 'PortalUnavailableError';
  }
}

export interface FiscalPortalStatus {
  environment: ExecutionEnvironment;
  /** False from the moment the breaker opens until a call to the portal succeeds again. */
  available: boolean;
  since: Date | null;
  /** When the next trial call is allowed; null while calls are allowed. */
  retryAt: Date | null;
}

/**
 * Circuit breaker for the national NFS-e portal, shared by every worker through Redis and kept
 * per environment (the restricted and the production portals fail independently).
 *
 * After `breakerThreshold` unanswered calls in a row it opens for `breakerCooldownMs`: emission
 * and reconciliation jobs wait instead of calling the portal. When the cooldown ends the next
 * call is the trial: a success closes it, a failure opens it again for another cooldown.
 */
@Injectable()
export class FiscalPortalBreaker {
  readonly settings: FiscalPortalConfig;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() config?: ConfigService,
  ) {
    this.settings = {
      ...DEFAULTS,
      ...config?.get<FiscalPortalConfig>('fiscalPortal'),
    };
  }

  private key(environment: ExecutionEnvironment, part: string): string {
    return `nfse:portal:${environment}:${part}`;
  }

  /** Throws `PortalUnavailableError` while the breaker is open. */
  async assertAvailable(environment: ExecutionEnvironment): Promise<void> {
    const until = Number(
      await this.redis.get(this.key(environment, 'open_until')),
    );
    if (until > Date.now()) throw new PortalUnavailableError(new Date(until));
  }

  private bucketKey(environment: ExecutionEnvironment, minute: number): string {
    return this.key(environment, `failures:m:${minute}`);
  }

  /** Unanswered calls to the portal in the last `windowMs` (at most 20 minutes), kept per minute. */
  async recentFailures(
    environment: ExecutionEnvironment,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<number> {
    const minutes = Math.min(Math.ceil(windowMs / MINUTE_MS), 20);
    const current = Math.floor(now / MINUTE_MS);
    const keys = Array.from({ length: minutes }, (_, i) =>
      this.bucketKey(environment, current - i),
    );
    const counts = await this.redis.mget(...keys);
    return counts.reduce((sum, value) => sum + Number(value ?? 0), 0);
  }

  async recordFailure(environment: ExecutionEnvironment): Promise<void> {
    const bucket = this.bucketKey(
      environment,
      Math.floor(Date.now() / MINUTE_MS),
    );
    await this.redis.incr(bucket);
    await this.redis.pexpire(bucket, BUCKET_TTL_MS);
    const failures = this.key(environment, 'failures');
    const count = await this.redis.incr(failures);
    await this.redis.pexpire(failures, FAILURE_WINDOW_MS);
    // First failure after a quiet window: a new outage begins, so an old start time must not survive.
    if (count === 1) await this.redis.del(this.key(environment, 'since'));
    if (count < this.settings.breakerThreshold) return;
    const now = Date.now();
    const cooldown = this.settings.breakerCooldownMs;
    // `since` outlives one cooldown so the banner stays up between trials, and expires on its
    // own if no call ever tries the portal again.
    const sinceTtl = cooldown * 2;
    await this.redis
      .multi()
      .set(
        this.key(environment, 'open_until'),
        String(now + cooldown),
        'PX',
        cooldown,
      )
      .set(this.key(environment, 'since'), String(now), 'PX', sinceTtl, 'NX')
      .pexpire(this.key(environment, 'since'), sinceTtl)
      .exec();
  }

  async recordSuccess(environment: ExecutionEnvironment): Promise<void> {
    const current = Math.floor(Date.now() / MINUTE_MS);
    await this.redis.del(
      ...Array.from({ length: 20 }, (_, i) =>
        this.bucketKey(environment, current - i),
      ),
      this.key(environment, 'failures'),
      this.key(environment, 'open_until'),
      this.key(environment, 'since'),
    );
  }

  async status(environment: ExecutionEnvironment): Promise<FiscalPortalStatus> {
    const [until, since] = await this.redis.mget(
      this.key(environment, 'open_until'),
      this.key(environment, 'since'),
    );
    const untilMs = Number(until);
    return {
      environment,
      available: !since,
      since: since ? new Date(Number(since)) : null,
      retryAt: untilMs > Date.now() ? new Date(untilMs) : null,
    };
  }
}
