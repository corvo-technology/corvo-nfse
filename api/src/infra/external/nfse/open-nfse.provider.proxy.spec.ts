import { Logger } from '@nestjs/common';
import { ProxyAgent } from 'undici';
import type { PortalHealth } from '@/modules/portal-reachability/reachability.classifier';
import { GovRouteSelector } from '@/modules/portal-reachability/gov-route.selector';
import { OpenNfseProvider } from './open-nfse.provider';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((options: unknown) => ({
    options,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PROXY = 'http://corvo:s3cret@proxy.example.com:3128';
const payload = (pfx = 'pfx', environment: 'live' | 'test' = 'live') => ({
  environment,
  pfxBuffer: Buffer.from(pfx),
  p12Password: 'pw',
});

type Route = (x: unknown) => Promise<{ options: { dispatcher?: unknown } }>;

function build(opts: { proxy?: string; state: PortalHealth }) {
  const config = {
    get: (key: string) =>
      key === 'FISCAL_HTTPS_PROXY' ? opts.proxy : undefined,
  };
  const store = {
    current: () =>
      Promise.resolve({ state: opts.state, since: null, ourSide: false }),
  };
  const selector = new GovRouteSelector(config as never, store as never);
  const provider = new OpenNfseProvider({} as never, config as never, selector);
  // The provider asks the selector for the dispatcher, then builds the client with it.
  const dispatcher = (pfx?: string, env?: 'live' | 'test') =>
    (
      provider as unknown as {
        routeFor: (x: unknown) => Promise<unknown>;
      }
    ).routeFor(payload(pfx, env));
  const clientOptions = async (pfx?: string) => {
    const d = await dispatcher(pfx);
    return (
      provider as unknown as {
        client: (
          x: unknown,
          s?: unknown,
          at?: Date,
          d?: unknown,
        ) => { options: { dispatcher?: unknown } };
      }
    ).client(payload(pfx), undefined, undefined, d).options;
  };
  return { provider, dispatcher, clientOptions };
}

beforeEach(() => (ProxyAgent as unknown as jest.Mock).mockClear());
afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider: backup route for government calls', () => {
  it('without FISCAL_HTTPS_PROXY the client has no dispatcher (any monitor state)', async () => {
    const { clientOptions } = build({ state: 'gov_unreachable_from_us' });
    expect((await clientOptions()).dispatcher).toBeUndefined();
    expect(ProxyAgent).not.toHaveBeenCalled();
  });

  it('with the proxy configured and the monitor ok, calls stay direct', async () => {
    const { clientOptions } = build({ proxy: PROXY, state: 'ok' });
    expect((await clientOptions()).dispatcher).toBeUndefined();
    expect(ProxyAgent).not.toHaveBeenCalled();
  });

  it('in gov_unreachable_from_us the client gets a ProxyAgent with the client cert in requestTls', async () => {
    const { clientOptions } = build({
      proxy: PROXY,
      state: 'gov_unreachable_from_us',
    });
    const options = await clientOptions();
    expect(options.dispatcher).toBeDefined();
    expect(ProxyAgent).toHaveBeenCalledTimes(1);
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: PROXY,
      requestTls: {
        key: 'MOCK-KEY',
        cert: 'MOCK-CERT',
        ALPNProtocols: ['http/1.1'],
      },
    });
  });

  it('stays direct for portal_down (the portal is the problem, not our network)', async () => {
    const { clientOptions } = build({ proxy: PROXY, state: 'portal_down' });
    expect((await clientOptions()).dispatcher).toBeUndefined();
  });

  it('reuses the agent for the same certificate', async () => {
    const { clientOptions } = build({
      proxy: PROXY,
      state: 'gov_unreachable_from_us',
    });
    const a = (await clientOptions('one')).dispatcher;
    expect((await clientOptions('one')).dispatcher).toBe(a);
    expect(ProxyAgent).toHaveBeenCalledTimes(1);
  });

  it('never logs the proxy credentials', async () => {
    const lines: string[] = [];
    const sink = (m: unknown) => void lines.push(String(m));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(sink);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(sink);
    const { clientOptions } = build({
      proxy: PROXY,
      state: 'gov_unreachable_from_us',
    });
    await clientOptions();
    const logged = lines.join('\n');
    expect(logged).toContain('proxy.example.com:3128');
    expect(logged).not.toMatch(/corvo:|s3cret/);
  });

  it('is optional in the constructor (no selector = always direct)', async () => {
    const provider = new OpenNfseProvider(
      {} as never,
      { get: () => undefined } as never,
    );
    const route = (provider as unknown as { routeFor: Route }).routeFor;
    await expect(route.call(provider, payload())).resolves.toBeUndefined();
  });
});
