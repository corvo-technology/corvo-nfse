/** The few Redis commands the fiscal breaker uses, in memory (values expire with `Date.now`). */
export class MemoryRedis {
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
