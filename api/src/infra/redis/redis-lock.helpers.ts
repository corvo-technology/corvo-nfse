import Redis from 'ioredis';
import { AcquiredLock } from './lock.port';
import {
  REDIS_LOCK_EXTEND_SCRIPT,
  REDIS_LOCK_RELEASE_SCRIPT,
} from './redis.constants';
import { buildRedisKey } from './redis-key.util';

export async function releaseRedisLock(
  redis: Redis,
  keyPrefix: string,
  lock: AcquiredLock,
): Promise<boolean> {
  const released = await redis.eval(
    REDIS_LOCK_RELEASE_SCRIPT,
    1,
    buildRedisKey(keyPrefix, 'lock', lock.key),
    lock.token,
  );

  return released === 1;
}

export async function extendRedisLock(
  redis: Redis,
  keyPrefix: string,
  lock: AcquiredLock,
  ttlMs: number,
): Promise<boolean> {
  const extended = await redis.eval(
    REDIS_LOCK_EXTEND_SCRIPT,
    1,
    buildRedisKey(keyPrefix, 'lock', lock.key),
    lock.token,
    ttlMs,
  );
  return extended === 1;
}
