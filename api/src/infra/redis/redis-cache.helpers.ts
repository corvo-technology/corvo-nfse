import Redis from 'ioredis';
import { buildRedisKey } from './redis-key.util';

export async function deleteRedisKeysByPattern(
  redis: Redis,
  keyPrefix: string,
  pattern: string,
): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  const match = buildRedisKey(keyPrefix, 'cache', pattern);

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      match,
      'COUNT',
      100,
    );

    cursor = nextCursor;

    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== '0');

  return deleted;
}
