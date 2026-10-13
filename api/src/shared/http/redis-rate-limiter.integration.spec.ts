import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisRateLimiter } from './redis-rate-limiter';
import type { RedisService } from '@/infra/redis/redis.service';
const url = process.env.RATE_LIMIT_TEST_REDIS_URL;
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Rate limiter integration requires local Redis');
const describeRedis = url ? describe : describe.skip;
describeRedis('shared rate limits on real Redis', () => {
  let client: Redis;
  let first: RedisRateLimiter;
  let second: RedisRateLimiter;
  const key = `test:${randomUUID()}`;
  beforeAll(async () => {
    client = new Redis(url!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    const service = { getClient: () => client } as unknown as RedisService;
    first = new RedisRateLimiter(service);
    second = new RedisRateLimiter(service);
  });
  afterAll(async () => {
    const keys = await client.keys(`corvo:ratelimit:${key}:*`);
    if (keys.length) await client.del(...keys);
    await client.quit();
  });
  it('allows exactly the shared budget under concurrency and always sets an expiry', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? first : second).check(key, { max: 10, windowMs: 60000 }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(10);
    const keys = await client.keys(`corvo:ratelimit:${key}:*`);
    expect(keys).toHaveLength(1);
    expect(await client.pttl(keys[0])).toBeGreaterThan(0);
  });
});
