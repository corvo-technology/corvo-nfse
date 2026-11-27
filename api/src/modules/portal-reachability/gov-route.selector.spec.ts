import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GovRouteSelector } from './gov-route.selector';
import type { PortalHealth } from './reachability.classifier';
import type { PortalReachabilityStore } from './reachability.store';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((options: unknown) => ({
    options,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PROXY = 'http://corvo:p@ssw0rd@proxy.example.com:3128';
const pem = { keyPem: 'K', certPem: 'C' };

function build(opts: { proxy?: string; state?: PortalHealth; redis?: Error }) {
  let now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const store = {
    current: jest.fn(async () => {
      await Promise.resolve();
      if (opts.redis) throw opts.redis;
      return { state: opts.state ?? 'ok', since: null, ourSide: false };
    }),
  } as unknown as PortalReachabilityStore;
  const config = {
    get: (key: string) =>
      key === 'FISCAL_HTTPS_PROXY' ? opts.proxy : undefined,
  } as unknown as ConfigService;
  const selector = new GovRouteSelector(config, store);
  return {
    selector,
    store,
    setState: (state: PortalHealth) => (opts.state = state),
    advance: (ms: number) => (now += ms),
  };
}

describe('GovRouteSelector', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    const sink = (m: unknown) => void logs.push(String(m));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(sink);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(sink);
  });
  afterEach(() => jest.restoreAllMocks());

  it('is direct when no proxy is configured, whatever the state', async () => {
    for (const state of [
      'ok',
      'gov_unreachable_from_us',
      'portal_down',
    ] as PortalHealth[]) {
      const { selector, store } = build({ state });
      await expect(selector.useProxy()).resolves.toBe(false);
      expect(store.current).not.toHaveBeenCalled();
    }
  });

  it('is direct with the proxy configured and the monitor ok', async () => {
    const { selector } = build({ proxy: PROXY, state: 'ok' });
    await expect(selector.useProxy()).resolves.toBe(false);
  });

  it('uses the proxy only for gov_unreachable_from_us', async () => {
    const { selector } = build({
      proxy: PROXY,
      state: 'gov_unreachable_from_us',
    });
    await expect(selector.useProxy()).resolves.toBe(true);
  });

  it.each(['portal_down', 'no_internet', 'emission_failures'] as const)(
    'stays direct for %s',
    async (state) => {
      const { selector } = build({ proxy: PROXY, state });
      await expect(selector.useProxy()).resolves.toBe(false);
    },
  );

  it('falls back to the direct route when Redis fails', async () => {
    const { selector } = build({
      proxy: PROXY,
      redis: new Error('redis down'),
    });
    await expect(selector.useProxy()).resolves.toBe(false);
  });

  it('caches the answer for 15 seconds', async () => {
    const { selector, store, setState, advance } = build({
      proxy: PROXY,
      state: 'ok',
    });
    await selector.useProxy();
    setState('gov_unreachable_from_us');
    advance(14_000);
    await expect(selector.useProxy()).resolves.toBe(false);
    expect(store.current).toHaveBeenCalledTimes(1);
    advance(2_000);
    await expect(selector.useProxy()).resolves.toBe(true);
    expect(store.current).toHaveBeenCalledTimes(2);
  });

  it('gives a dispatcher only for allowlisted hosts during the incident', async () => {
    const { selector } = build({
      proxy: PROXY,
      state: 'gov_unreachable_from_us',
    });
    await expect(
      selector.dispatcherFor('nfe.fazenda.sp.gov.br', 'sefaz', pem, 'CA'),
    ).resolves.toBeDefined();
    await expect(
      selector.dispatcherFor('example.com', 'sefaz', pem),
    ).resolves.toBeUndefined();
    await expect(
      selector.dispatcherFor('evil.gov.br.example.com', 'sefaz', pem),
    ).resolves.toBeUndefined();
  });

  it('gives no dispatcher outside the incident', async () => {
    const { selector } = build({ proxy: PROXY, state: 'ok' });
    await expect(
      selector.dispatcherFor('nfe.fazenda.sp.gov.br', 'sefaz', pem),
    ).resolves.toBeUndefined();
  });

  it('logs once per change and never the credentials', async () => {
    const { selector, setState, advance } = build({
      proxy: PROXY,
      state: 'ok',
    });
    await selector.useProxy();
    setState('gov_unreachable_from_us');
    advance(20_000);
    await selector.useProxy();
    advance(20_000);
    await selector.useProxy();
    setState('ok');
    advance(20_000);
    await selector.useProxy();
    const text = logs.join('\n');
    expect(text.match(/now go through/g)).toHaveLength(1);
    expect(text.match(/go direct again/g)).toHaveLength(1);
    expect(text).toContain('proxy.example.com:3128');
    expect(text).not.toContain('p@');
    expect(text).not.toContain('ssw0rd');
    expect(text).not.toContain('corvo:');
  });
});
