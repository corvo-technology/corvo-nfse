import { RedisRateLimiter } from './redis-rate-limiter';
import type { RedisService } from '@/infra/redis/redis.service';

describe('atomic rate limiter with bounded local fallback', () => {
  const evalCommand = jest.fn();
  const redis = {
    getClient: () => ({ eval: evalCommand }),
  } as unknown as RedisService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(60000);
    evalCommand.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it('uses one atomic command with a TTL and enforces the boundary', async () => {
    evalCommand.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const limiter = new RedisRateLimiter(redis);
    expect(await limiter.check('test', { max: 2, windowMs: 60000 })).toEqual({
      allowed: true,
      remaining: 0,
      resetAt: 120000,
    });
    expect(
      (await limiter.check('test', { max: 2, windowMs: 60000 })).allowed,
    ).toBe(false);
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      'corvo:ratelimit:test:60000',
      60000,
    );
  });
  it('limits locally during an outage, expires counters and retries Redis after 5 seconds', async () => {
    evalCommand.mockRejectedValue(new Error('offline'));
    const limiter = new RedisRateLimiter(redis);
    expect(
      (await limiter.check('test', { max: 1, windowMs: 60000 })).allowed,
    ).toBe(true);
    expect(
      (await limiter.check('test', { max: 1, windowMs: 60000 })).allowed,
    ).toBe(false);
    expect(evalCommand).toHaveBeenCalledTimes(1);
    jest.setSystemTime(65001);
    evalCommand.mockResolvedValue(1);
    expect(
      (await limiter.check('test', { max: 1, windowMs: 60000 })).allowed,
    ).toBe(true);
    expect(evalCommand).toHaveBeenCalledTimes(2);
    jest.setSystemTime(120001);
    evalCommand.mockRejectedValue(new Error('offline'));
    expect(
      (await limiter.check('test', { max: 1, windowMs: 60000 })).allowed,
    ).toBe(true);
  });
});
