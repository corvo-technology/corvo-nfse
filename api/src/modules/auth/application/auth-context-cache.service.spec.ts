import type { CachePort } from '@/infra/redis/cache.port';
import type { AuthContext } from '../auth-context';
import {
  AUTH_CONTEXT_CACHE_TTL_SECONDS,
  AuthContextCacheService,
} from './auth-context-cache.service';

describe(AuthContextCacheService.name, () => {
  const context = {
    authUserId: 'auth-1',
    productKey: 'greenbarber',
    activeTenantId: 'tenant-1',
  } as AuthContext;

  function setup() {
    const cache: jest.Mocked<CachePort> = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      deleteByPattern: jest.fn(),
      remember: jest.fn(),
    };
    return { cache, service: new AuthContextCacheService(cache) };
  }

  it('isolates entries by user, product and active tenant with a 5 minute TTL', async () => {
    const { cache, service } = setup();

    await service.set('auth-1', 'greenbarber', 'tenant-1', context);
    await service.get('auth-1', 'greenbarber', 'tenant-2');

    expect(cache.set).toHaveBeenCalledWith(
      'auth-context:v2:auth-1:greenbarber:tenant-1',
      context,
      { ttlSeconds: AUTH_CONTEXT_CACHE_TTL_SECONDS },
    );
    expect(cache.get).toHaveBeenCalledWith(
      'auth-context:v2:auth-1:greenbarber:tenant-2',
    );
  });

  it('invalidates every cached context variant for a user', async () => {
    const { cache, service } = setup();
    cache.deleteByPattern.mockResolvedValue(3);

    await service.invalidateUser('auth-1');

    expect(cache.deleteByPattern).toHaveBeenCalledWith(
      'auth-context:v2:auth-1:*',
    );
  });

  it('fails open when Redis is unavailable', async () => {
    const { cache, service } = setup();
    cache.get.mockRejectedValue(new Error('redis unavailable'));
    cache.set.mockRejectedValue(new Error('redis unavailable'));
    cache.deleteByPattern.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.get('auth-1', 'greenbarber', 'tenant-1'),
    ).resolves.toBeNull();
    await expect(
      service.set('auth-1', 'greenbarber', 'tenant-1', context),
    ).resolves.toBeUndefined();
    await expect(service.invalidateUser('auth-1')).resolves.toBeUndefined();
  });
});
