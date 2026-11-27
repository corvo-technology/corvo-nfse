import type { ConfigService } from '@nestjs/config';
import type { CachePort } from '@/infra/redis/cache.port';
import { NfeAccessPolicy } from './nfe-access.policy';

function build(options: {
  env: boolean;
  releasedAt: Date | null;
  nfceReleasedAt?: Date | null;
}) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  } as unknown as CachePort;
  const release = {
    releasedAt: jest.fn((_tenant: string, type: 'nfe' | 'nfce' = 'nfe') =>
      Promise.resolve(
        type === 'nfce' ? (options.nfceReleasedAt ?? null) : options.releasedAt,
      ),
    ),
  };
  const config = {
    get: jest.fn(() => options.env),
  } as unknown as ConfigService;
  return {
    policy: new NfeAccessPolicy(config, release, cache),
    release,
    cache,
  };
}

describe('NfeAccessPolicy', () => {
  it('is off when the env flag is off, even with the tenant released', async () => {
    const { policy, release } = build({ env: false, releasedAt: new Date() });
    await expect(policy.isEnabled('t1')).resolves.toBe(false);
    expect(release.releasedAt).not.toHaveBeenCalled();
  });

  it('is off when the env flag is on and the tenant is not released', async () => {
    const { policy } = build({ env: true, releasedAt: null });
    await expect(policy.isEnabled('t1')).resolves.toBe(false);
  });

  it('is on when both are on, and caches the answer', async () => {
    const { policy, release, cache } = build({
      env: true,
      releasedAt: new Date(),
    });
    await expect(policy.isEnabled('t1')).resolves.toBe(true);
    await expect(policy.isEnabled('t1')).resolves.toBe(true);
    expect(release.releasedAt).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith('nfe:enabled:t1', true, {
      ttlSeconds: 60,
    });
  });

  it('releases NF-e and NFC-e separately, each with its own cache key', async () => {
    const { policy, cache } = build({
      env: true,
      releasedAt: new Date(),
      nfceReleasedAt: null,
    });
    await expect(policy.isEnabled('t1', 'nfe')).resolves.toBe(true);
    await expect(policy.isEnabled('t1', 'nfce')).resolves.toBe(false);
    expect(cache.set).toHaveBeenCalledWith('nfce:enabled:t1', false, {
      ttlSeconds: 60,
    });
  });

  it('is off for NFC-e when the env flag is off', async () => {
    const { policy } = build({
      env: false,
      releasedAt: new Date(),
      nfceReleasedAt: new Date(),
    });
    await expect(policy.isEnabled('t1', 'nfce')).resolves.toBe(false);
  });
});
