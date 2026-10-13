import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      keyPrefix: 'test',
      cacheDefaultTtlSeconds: 60,
    }),
  } as unknown as ConfigService;

  function createRedisMock() {
    return {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
    };
  }

  it('stores and reads JSON values', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(JSON.stringify({ id: 'client-1' }));
    const service = new RedisCacheService(
      redis as unknown as Redis,
      configService,
    );

    const value = await service.get<{ id: string }>('clients:1');
    await service.set('clients:1', { id: 'client-1' });

    expect(value).toEqual({ id: 'client-1' });
    expect(redis.get).toHaveBeenCalledWith('test:cache:clients:1');
    expect(redis.set).toHaveBeenCalledWith(
      'test:cache:clients:1',
      JSON.stringify({ id: 'client-1' }),
      'EX',
      60,
    );
  });

  it('returns null on cache miss', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(null);
    const service = new RedisCacheService(
      redis as unknown as Redis,
      configService,
    );

    await expect(service.get('missing')).resolves.toBeNull();
  });

  it('remember returns cached value without calling factory', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(JSON.stringify('cached'));
    const factory = jest.fn();
    const service = new RedisCacheService(
      redis as unknown as Redis,
      configService,
    );

    await expect(service.remember('key', factory)).resolves.toBe('cached');
    expect(factory).not.toHaveBeenCalled();
  });

  it('remember stores factory result on miss', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(null);
    const factory = jest.fn().mockResolvedValue({ ok: true });
    const service = new RedisCacheService(
      redis as unknown as Redis,
      configService,
    );

    await expect(service.remember('key', factory)).resolves.toEqual({
      ok: true,
    });
    expect(redis.set).toHaveBeenCalledWith(
      'test:cache:key',
      JSON.stringify({ ok: true }),
      'EX',
      60,
    );
  });

  it('deletes keys by pattern using scan', async () => {
    const redis = createRedisMock();
    redis.scan
      .mockResolvedValueOnce(['2', ['test:cache:a', 'test:cache:b']])
      .mockResolvedValueOnce(['0', []]);
    redis.del.mockResolvedValue(2);
    const service = new RedisCacheService(
      redis as unknown as Redis,
      configService,
    );

    await expect(service.deleteByPattern('clients:*')).resolves.toBe(2);
    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'test:cache:clients:*',
      'COUNT',
      100,
    );
    expect(redis.del).toHaveBeenCalledWith('test:cache:a', 'test:cache:b');
  });
});
