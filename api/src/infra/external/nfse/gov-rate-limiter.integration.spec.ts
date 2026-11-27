import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { PortalUnavailableError } from '@/modules/invoice/application/fiscal-portal-breaker';
import { GovRateLimiter } from './gov-rate-limiter';

const url = process.env.RATE_LIMIT_TEST_REDIS_URL;
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Government rate limit integration requires local Redis');
const describeRedis = url ? describe : describe.skip;

describeRedis('GovRateLimiter on real Redis', () => {
  let client: Redis;
  const hosts: string[] = [];
  const host = () => {
    const name = `test-${randomUUID()}`;
    hosts.push(name);
    return name;
  };
  const make = (perSecond: number, burst: number, maxWaitMs: number) =>
    new GovRateLimiter(client, {
      get: () => ({ perSecond, burst, maxWaitMs }),
    } as never);

  beforeAll(async () => {
    client = new Redis(url!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
  });
  afterAll(async () => {
    for (const name of hosts)
      await client.del(`gov:bucket:${name}`, `gov:pause:${name}`);
    await client.quit();
  });

  it('grants exactly the burst at once, across replicas, and refuses the rest', async () => {
    const name = host();
    const replicas = [make(1, 5, 100), make(1, 5, 100)];
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        replicas[i % 2].acquire(name).then(
          () => 'granted',
          (error: unknown) =>
            error instanceof PortalUnavailableError ? 'refused' : 'other',
        ),
      ),
    );
    expect(results.filter((r) => r === 'granted')).toHaveLength(5);
    expect(results.filter((r) => r === 'refused')).toHaveLength(7);
  });

  it('refills at the sustained rate: a caller waits and then gets its token', async () => {
    const name = host();
    const limiter = make(20, 1, 2_000);
    await limiter.acquire(name);
    const started = Date.now();
    await limiter.acquire(name);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(30);
    expect(waited).toBeLessThan(1_000);
  });

  it('keeps hosts apart', async () => {
    const [a, b] = [host(), host()];
    const limiter = make(1, 1, 100);
    await limiter.acquire(a);
    await expect(limiter.acquire(a)).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );
    await expect(limiter.acquire(b)).resolves.toBeUndefined();
  });

  it('honors a pause stored in Redis for every replica, with a TTL', async () => {
    const name = host();
    const first = make(5, 10, 100);
    const second = make(5, 10, 100);
    await first.pause(name, 20_000);
    expect(await client.pttl(`gov:pause:${name}`)).toBeGreaterThan(0);
    const error = await second.acquire(name).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PortalUnavailableError);
    expect(
      (error as PortalUnavailableError).retryAt.getTime() - Date.now(),
    ).toBeGreaterThan(10_000);
  });
});
