import type Redis from 'ioredis';
import { AuthorityReachabilityStore } from './authority-reachability.store';

/** A tiny in-memory Redis: just the commands the store uses. */
function fakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const ttl = new Map<string, number>();
  const redis = {
    multi: () => {
      const ops: Array<() => void> = [];
      const chain = {
        del: (key: string) => {
          ops.push(() => hashes.delete(key));
          return chain;
        },
        hset: (key: string, values: Record<string, string>) => {
          ops.push(() => hashes.set(key, { ...values }));
          return chain;
        },
        pexpire: (key: string, ms: number) => {
          ops.push(() => ttl.set(key, ms));
          return chain;
        },
        exec: () => {
          ops.forEach((op) => op());
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    hget: (key: string, field: string) =>
      Promise.resolve(hashes.get(key)?.[field] ?? null),
    hgetall: (key: string) => Promise.resolve(hashes.get(key) ?? {}),
  };
  return { redis: redis as unknown as Redis, hashes, ttl };
}

describe('AuthorityReachabilityStore', () => {
  const at = new Date('2026-11-26T15:00:00.000Z');

  it('remembers each authority with the time of the check', async () => {
    const { redis, ttl } = fakeRedis();
    const store = new AuthorityReachabilityStore(redis);
    await store.save({ 'nfe-sp-2': false, 'nfce-sp-2': true }, at);
    expect(await store.get('nfe-sp-2')).toEqual({
      authority: 'nfe-sp-2',
      reachable: false,
      checkedAt: at.toISOString(),
    });
    expect((await store.all()).map((row) => row.authority)).toEqual([
      'nfce-sp-2',
      'nfe-sp-2',
    ]);
    expect([...ttl.values()]).toEqual([600_000]);
  });

  it('answers null for an authority that was never probed', async () => {
    const store = new AuthorityReachabilityStore(fakeRedis().redis);
    expect(await store.get('nfe-mg-2')).toBeNull();
    expect(await store.all()).toEqual([]);
  });

  it('drops an authority that is no longer probed', async () => {
    const store = new AuthorityReachabilityStore(fakeRedis().redis);
    await store.save({ 'nfe-sp-2': true }, at);
    await store.save({}, at);
    expect(await store.all()).toEqual([]);
  });

  it('ignores a damaged entry', async () => {
    const { redis, hashes } = fakeRedis();
    hashes.set('ops:fiscal-authority-reachability', {
      'nfe-sp-2': 'not json',
      'nfe-mg-2': '{"reachable":"yes"}',
    });
    const store = new AuthorityReachabilityStore(redis);
    expect(await store.get('nfe-sp-2')).toBeNull();
    expect(await store.all()).toEqual([]);
  });
});
