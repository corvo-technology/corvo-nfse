import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from './fiscal-portal-breaker';

/** The few Redis commands the breaker uses, with expiry, in memory. */
class MemoryRedis {
  private values = new Map<string, { value: string; expiresAt?: number }>();
  now = () => Date.now();
  private live(key: string) {
    const entry = this.values.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }
  get = async (key: string) => this.live(key)?.value ?? null;
  mget = async (...keys: string[]) =>
    keys.map((k) => this.live(k)?.value ?? null);
  incr = async (key: string) => {
    const next = Number(this.live(key)?.value ?? 0) + 1;
    this.values.set(key, { ...this.values.get(key), value: String(next) });
    return next;
  };
  pexpire = async (key: string, ms: number) => {
    const entry = this.live(key);
    if (entry) entry.expiresAt = this.now() + ms;
    return entry ? 1 : 0;
  };
  set = async (
    key: string,
    value: string,
    _px: 'PX',
    ms: number,
    nx?: 'NX',
  ) => {
    if (nx && this.live(key)) return null;
    this.values.set(key, { value, expiresAt: this.now() + ms });
    return 'OK';
  };
  del = async (...keys: string[]) => {
    keys.forEach((k) => this.values.delete(k));
    return keys.length;
  };
  multi = () => {
    const queued: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...args: Parameters<MemoryRedis['set']>) => {
        queued.push(() => this.set(...args));
        return chain;
      },
      pexpire: (key: string, ms: number) => {
        queued.push(() => this.pexpire(key, ms));
        return chain;
      },
      exec: async () => {
        for (const run of queued) await run();
        return [];
      },
    };
    return chain;
  };
}

describe('FiscalPortalBreaker', () => {
  let clock: number;
  let redis: MemoryRedis;
  let breaker: FiscalPortalBreaker;

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 8, 12);
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    redis = new MemoryRedis();
    breaker = new FiscalPortalBreaker(
      redis as never,
      {
        get: () => ({ breakerThreshold: 3, breakerCooldownMs: 60_000 }),
      } as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const failTimes = async (n: number) => {
    for (let i = 0; i < n; i++) await breaker.recordFailure('live');
  };

  it('keeps calling the portal below the threshold', async () => {
    await failTimes(2);
    await expect(breaker.assertAvailable('live')).resolves.toBeUndefined();
    expect((await breaker.status('live')).available).toBe(true);
  });

  it('pauses after the threshold and reports since and retryAt', async () => {
    await failTimes(3);
    await expect(breaker.assertAvailable('live')).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );
    const status = await breaker.status('live');
    expect(status).toMatchObject({ available: false, environment: 'live' });
    expect(status.since?.getTime()).toBe(clock);
    expect(status.retryAt?.getTime()).toBe(clock + 60_000);
  });

  it('lets one trial through after the cooldown and stays down until it succeeds', async () => {
    await failTimes(3);
    clock += 60_001;
    await expect(breaker.assertAvailable('live')).resolves.toBeUndefined();
    expect((await breaker.status('live')).available).toBe(false);

    await breaker.recordFailure('live');
    await expect(breaker.assertAvailable('live')).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );

    clock += 60_001;
    await breaker.recordSuccess('live');
    expect(await breaker.status('live')).toEqual({
      environment: 'live',
      available: true,
      since: null,
      retryAt: null,
    });
  });

  it('keeps the test and live portals apart', async () => {
    await failTimes(3);
    await expect(breaker.assertAvailable('test')).resolves.toBeUndefined();
  });

  it('a success resets the count of failures in a row', async () => {
    await failTimes(2);
    await breaker.recordSuccess('live');
    await failTimes(2);
    await expect(breaker.assertAvailable('live')).resolves.toBeUndefined();
  });
});
