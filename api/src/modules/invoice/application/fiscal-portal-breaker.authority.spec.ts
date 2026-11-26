import {
  FiscalPortalBreaker,
  PortalUnavailableError,
  nfeBreakerAuthority,
} from './fiscal-portal-breaker';

/** The Redis commands the breaker uses, with expiry and sets, in memory. */
class MemoryRedis {
  readonly values = new Map<string, { value: string; expiresAt?: number }>();
  readonly sets = new Map<string, Set<string>>();
  private live(key: string) {
    const entry = this.values.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }
  get = (key: string) => Promise.resolve(this.live(key)?.value ?? null);
  mget = (...keys: string[]) =>
    Promise.resolve(keys.map((k) => this.live(k)?.value ?? null));
  incr = (key: string) => {
    const next = Number(this.live(key)?.value ?? 0) + 1;
    this.values.set(key, { ...this.values.get(key), value: String(next) });
    return Promise.resolve(next);
  };
  pexpire = (key: string, ms: number) => {
    const entry = this.live(key);
    if (entry) entry.expiresAt = Date.now() + ms;
    return Promise.resolve(entry ? 1 : 0);
  };
  set = (key: string, value: string, _px: 'PX', ms: number, nx?: 'NX') => {
    if (nx && this.live(key)) return Promise.resolve(null);
    this.values.set(key, { value, expiresAt: Date.now() + ms });
    return Promise.resolve('OK');
  };
  del = (...keys: string[]) => {
    keys.forEach((k) => this.values.delete(k));
    return Promise.resolve(keys.length);
  };
  sadd = (key: string, member: string) => {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
    return Promise.resolve(1);
  };
  smembers = (key: string) => Promise.resolve([...(this.sets.get(key) ?? [])]);
  multi = () => {
    const queued: Array<() => Promise<unknown>> = [];
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

describe('FiscalPortalBreaker per authority', () => {
  let clock: number;
  let redis: MemoryRedis;
  let breaker: FiscalPortalBreaker;
  const sp = nfeBreakerAuthority('SP', 2);
  const svrs = nfeBreakerAuthority('SVRS', 2);

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 26, 12);
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    redis = new MemoryRedis();
    breaker = new FiscalPortalBreaker(
      redis as never,
      {
        get: () => ({ breakerThreshold: 2, breakerCooldownMs: 60_000 }),
      } as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('names the NF-e authorities nfe-<authority>-<tpAmb>', () => {
    expect(sp).toBe('nfe-sp-2');
    expect(svrs).toBe('nfe-svrs-2');
    expect(nfeBreakerAuthority('SVAN', 1)).toBe('nfe-svan-1');
  });

  it('opening nfe-sp-2 does not affect nfse-sefin nor nfe-svrs-2', async () => {
    await breaker.recordFailure('test', sp);
    await breaker.recordFailure('test', sp);
    await expect(breaker.assertAvailable('test', sp)).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );
    await expect(breaker.assertAvailable('test')).resolves.toBeUndefined();
    await expect(
      breaker.assertAvailable('test', svrs),
    ).resolves.toBeUndefined();
    expect((await breaker.status('test')).available).toBe(true);
  });

  it('a call without authority keeps the historical NFS-e keys', async () => {
    await breaker.recordFailure('live');
    await breaker.recordFailure('live');
    const keys = [...redis.values.keys()];
    expect(keys).toEqual(
      expect.arrayContaining([
        'nfse:portal:live:failures',
        'nfse:portal:live:open_until',
        'nfse:portal:live:since',
      ]),
    );
    expect(keys.some((k) => k.startsWith('fiscal:breaker'))).toBe(false);
    expect(redis.sets.size).toBe(0);
  });

  it('other authorities use fiscal:breaker:<authority>:<part>', async () => {
    await breaker.recordFailure('test', sp);
    expect([...redis.values.keys()]).toEqual([
      'fiscal:breaker:nfe-sp-2:failures',
    ]);
  });

  it('a success on the authority closes only that one', async () => {
    for (const a of [sp, svrs]) {
      await breaker.recordFailure('test', a);
      await breaker.recordFailure('test', a);
    }
    await breaker.recordSuccess('test', sp);
    await expect(breaker.assertAvailable('test', sp)).resolves.toBeUndefined();
    await expect(breaker.assertAvailable('test', svrs)).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );
  });

  it('lists only the NF-e authorities already used, with their state', async () => {
    expect(await breaker.authorities()).toEqual([]);
    await breaker.recordFailure('test', sp);
    await breaker.recordFailure('test', sp);
    await breaker.recordSuccess('test', svrs);
    const list = await breaker.authorities();
    expect(list.map((a) => a.authority)).toEqual(['nfe-sp-2', 'nfe-svrs-2']);
    expect(list[0]).toMatchObject({ available: false });
    expect(list[0].retryAt?.getTime()).toBe(clock + 60_000);
    expect(list[1]).toEqual({
      authority: 'nfe-svrs-2',
      available: true,
      since: null,
      retryAt: null,
    });
  });
});
