import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';

const KEY = 'ops:fiscal-authority-reachability';
/** Ten minutes: if the monitor stops, the answers expire instead of looking current. */
const TTL_MS = 10 * 60_000;

export interface AuthorityReachability {
  authority: string;
  reachable: boolean;
  checkedAt: string;
}

/** What the last TCP probe said about each SEFAZ authority, shared by every replica through Redis. */
@Injectable()
export class AuthorityReachabilityStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Replaces the whole picture: an authority that is no longer probed disappears. */
  async save(results: Record<string, boolean>, at: Date): Promise<void> {
    const checkedAt = at.toISOString();
    const fields = Object.entries(results).map(
      ([authority, reachable]) =>
        [authority, JSON.stringify({ reachable, checkedAt })] as const,
    );
    const pipeline = this.redis.multi().del(KEY);
    if (fields.length > 0)
      pipeline.hset(KEY, Object.fromEntries(fields)).pexpire(KEY, TTL_MS);
    await pipeline.exec();
  }

  async get(authority: string): Promise<AuthorityReachability | null> {
    const raw = await this.redis.hget(KEY, authority);
    return raw ? parse(authority, raw) : null;
  }

  async all(): Promise<AuthorityReachability[]> {
    const rows = await this.redis.hgetall(KEY);
    return Object.entries(rows)
      .flatMap(([authority, raw]) => {
        const found = parse(authority, raw);
        return found ? [found] : [];
      })
      .sort((a, b) => a.authority.localeCompare(b.authority));
  }
}

function parse(authority: string, raw: string): AuthorityReachability | null {
  try {
    const value = JSON.parse(raw) as {
      reachable?: unknown;
      checkedAt?: unknown;
    };
    if (typeof value.reachable !== 'boolean') return null;
    if (typeof value.checkedAt !== 'string') return null;
    return {
      authority,
      reachable: value.reachable,
      checkedAt: value.checkedAt,
    };
  } catch {
    return null;
  }
}
