import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { FiscalPortalConfig } from '@/infra/config/configuration.types';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import type { AuthorityId } from '@/modules/fiscal-core/domain/ports/authority.port';
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
 * What the breaker protects: `nfse-sefin` (the national NFS-e portal, the default) or
 * `nfe-<authority in lower case>-<tpAmb>` (one SEFAZ authority in one environment, for example
 * `nfe-sp-2` or `nfe-svrs-2`).
 */
export type BreakerAuthority = string;

export const NFSE_BREAKER_AUTHORITY: BreakerAuthority = 'nfse-sefin';

export function nfeBreakerAuthority(
  authority: AuthorityId,
  tpAmb: 1 | 2,
): BreakerAuthority {
  return `nfe-${authority.toLowerCase()}-${tpAmb}`;
}

/** Redis set with the NF-e authorities the breaker has seen, so the status can list them. */
const AUTHORITIES_KEY = 'fiscal:breaker:authorities';

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

export interface FiscalAuthorityStatus {
  authority: BreakerAuthority;
  available: boolean;
  since: Date | null;
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

  /** The NFS-e key is the historical one and never changes; every other authority has its own. */
  private key(
    environment: ExecutionEnvironment,
    part: string,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): string {
    return authority === NFSE_BREAKER_AUTHORITY
      ? `nfse:portal:${environment}:${part}`
      : `fiscal:breaker:${authority}:${part}`;
  }

  private async remember(authority: BreakerAuthority): Promise<void> {
    if (authority !== NFSE_BREAKER_AUTHORITY)
      await this.redis.sadd(AUTHORITIES_KEY, authority);
  }

  /** Throws `PortalUnavailableError` while the breaker is open. */
  async assertAvailable(
    environment: ExecutionEnvironment,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): Promise<void> {
    const until = Number(
      await this.redis.get(this.key(environment, 'open_until', authority)),
    );
    if (until > Date.now()) throw new PortalUnavailableError(new Date(until));
  }

  private bucketKey(
    environment: ExecutionEnvironment,
    minute: number,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): string {
    return this.key(environment, `failures:m:${minute}`, authority);
  }

  /** Unanswered calls to the portal in the last `windowMs` (at most 20 minutes), kept per minute. */
  async recentFailures(
    environment: ExecutionEnvironment,
    windowMs: number,
    now: number = Date.now(),
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): Promise<number> {
    const minutes = Math.min(Math.ceil(windowMs / MINUTE_MS), 20);
    const current = Math.floor(now / MINUTE_MS);
    const keys = Array.from({ length: minutes }, (_, i) =>
      this.bucketKey(environment, current - i, authority),
    );
    const counts = await this.redis.mget(...keys);
    return counts.reduce((sum, value) => sum + Number(value ?? 0), 0);
  }

  async recordFailure(
    environment: ExecutionEnvironment,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): Promise<void> {
    await this.remember(authority);
    const bucket = this.bucketKey(
      environment,
      Math.floor(Date.now() / MINUTE_MS),
      authority,
    );
    await this.redis.incr(bucket);
    await this.redis.pexpire(bucket, BUCKET_TTL_MS);
    const failures = this.key(environment, 'failures', authority);
    const count = await this.redis.incr(failures);
    await this.redis.pexpire(failures, FAILURE_WINDOW_MS);
    if (count < this.settings.breakerThreshold) return;
    const now = Date.now();
    const cooldown = this.settings.breakerCooldownMs;
    // `since` outlives one cooldown so the banner stays up between trials, and expires on its
    // own if no call ever tries the portal again.
    const sinceTtl = cooldown * 3;
    await this.redis
      .multi()
      .set(
        this.key(environment, 'open_until', authority),
        String(now + cooldown),
        'PX',
        cooldown,
      )
      .set(
        this.key(environment, 'since', authority),
        String(now),
        'PX',
        sinceTtl,
        'NX',
      )
      .pexpire(this.key(environment, 'since', authority), sinceTtl)
      .exec();
  }

  async recordSuccess(
    environment: ExecutionEnvironment,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): Promise<void> {
    await this.remember(authority);
    const current = Math.floor(Date.now() / MINUTE_MS);
    await this.redis.del(
      ...Array.from({ length: 20 }, (_, i) =>
        this.bucketKey(environment, current - i, authority),
      ),
      this.key(environment, 'failures', authority),
      this.key(environment, 'open_until', authority),
      this.key(environment, 'since', authority),
    );
  }

  async status(
    environment: ExecutionEnvironment,
    authority: BreakerAuthority = NFSE_BREAKER_AUTHORITY,
  ): Promise<FiscalPortalStatus> {
    const [until, since] = await this.redis.mget(
      this.key(environment, 'open_until', authority),
      this.key(environment, 'since', authority),
    );
    const untilMs = Number(until);
    return {
      environment,
      available: !since,
      since: since ? new Date(Number(since)) : null,
      retryAt: untilMs > Date.now() ? new Date(untilMs) : null,
    };
  }

  /**
   * Every NF-e authority the breaker has seen, with its state. The environment is part of the
   * name (`nfe-sp-2`), so it is not needed here.
   */
  async authorities(): Promise<FiscalAuthorityStatus[]> {
    const names = (await this.redis.smembers(AUTHORITIES_KEY)).sort();
    return Promise.all(
      names.map(async (authority) => {
        const [until, since] = await this.redis.mget(
          this.key('test', 'open_until', authority),
          this.key('test', 'since', authority),
        );
        const untilMs = Number(until);
        return {
          authority,
          available: !since,
          since: since ? new Date(Number(since)) : null,
          retryAt: untilMs > Date.now() ? new Date(untilMs) : null,
        };
      }),
    );
  }
}
