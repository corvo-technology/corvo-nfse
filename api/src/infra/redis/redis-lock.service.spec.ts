import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  REDIS_LOCK_EXTEND_SCRIPT,
  REDIS_LOCK_RELEASE_SCRIPT,
} from './redis.constants';
import { RedisLockService } from './redis-lock.service';

describe('RedisLockService', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      keyPrefix: 'test',
    }),
  } as unknown as ConfigService;

  function createRedisMock() {
    return {
      set: jest.fn(),
      eval: jest.fn(),
    };
  }

  it('acquires a lock with a unique token', async () => {
    const redis = createRedisMock();
    redis.set.mockResolvedValue('OK');
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    const lock = await service.acquire('conversation:1', { ttlMs: 5000 });

    expect(lock?.key).toBe('conversation:1');
    expect(typeof lock?.token).toBe('string');
    expect(lock?.ttlMs).toBe(5000);
    expect(redis.set).toHaveBeenCalledWith(
      'test:lock:conversation:1',
      expect.any(String),
      'PX',
      5000,
      'NX',
    );
  });

  it('returns null when lock is already held', async () => {
    const redis = createRedisMock();
    redis.set.mockResolvedValue(null);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.acquire('conversation:1', { ttlMs: 5000 }),
    ).resolves.toBeNull();
  });

  it('releases a lock only through the token script', async () => {
    const redis = createRedisMock();
    redis.eval.mockResolvedValue(1);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.release({
        key: 'conversation:1',
        token: 'token-1',
        ttlMs: 5000,
      }),
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      REDIS_LOCK_RELEASE_SCRIPT,
      1,
      'test:lock:conversation:1',
      'token-1',
    );
  });

  it('renews a lock only through the token script', async () => {
    const redis = createRedisMock();
    redis.eval.mockResolvedValue(1);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.extend(
        { key: 'conversation:1', token: 'token-1', ttlMs: 5000 },
        7000,
      ),
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      REDIS_LOCK_EXTEND_SCRIPT,
      1,
      'test:lock:conversation:1',
      'token-1',
      7000,
    );
  });

  it('withLock releases after success', async () => {
    const redis = createRedisMock();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.withLock('job:1', { ttlMs: 1000 }, () => Promise.resolve('done')),
    ).resolves.toBe('done');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('withLock releases after errors', async () => {
    const redis = createRedisMock();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.withLock('job:1', { ttlMs: 1000 }, () =>
        Promise.reject(new Error('failed')),
      ),
    ).rejects.toThrow('failed');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('withLock throws when lock cannot be acquired', async () => {
    const redis = createRedisMock();
    redis.set.mockResolvedValue(null);
    const service = new RedisLockService(
      redis as unknown as Redis,
      configService,
    );

    await expect(
      service.withLock('job:1', { ttlMs: 1000 }, () => Promise.resolve('done')),
    ).rejects.toThrow('Could not acquire lock: job:1');
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
