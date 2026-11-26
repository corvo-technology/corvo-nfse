import { Logger } from '@nestjs/common';
import { ProxyAgent } from 'undici';
import { OpenNfseProvider } from './open-nfse.provider';
import { isGovNfseHost, redactProxyUrl } from './gov-proxy';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((options: unknown) => ({
    options,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PROXY = 'http://corvo:s3cret@proxy.example.com:3128';
const payload = (pfx = 'pfx') => ({
  environment: 'live' as const,
  pfxBuffer: Buffer.from(pfx),
  p12Password: 'pw',
});

const provider = (config: Record<string, string> = {}) =>
  new OpenNfseProvider({} as never, { get: (k: string) => config[k] } as never);

const clientOptions = (p: OpenNfseProvider, pfx?: string) =>
  (
    p as unknown as {
      client: (x: unknown) => { options: { dispatcher?: unknown } };
    }
  ).client(payload(pfx)).options;

afterEach(() => jest.restoreAllMocks());
beforeEach(() => (ProxyAgent as unknown as jest.Mock).mockClear());

describe('OpenNfseProvider: optional proxy for government calls', () => {
  it('without FISCAL_HTTPS_PROXY there is no dispatcher and no ProxyAgent', () => {
    expect(clientOptions(provider()).dispatcher).toBeUndefined();
    expect(ProxyAgent).not.toHaveBeenCalled();
  });

  it('with FISCAL_HTTPS_PROXY the client gets a ProxyAgent that keeps the client cert in requestTls', () => {
    const options = clientOptions(provider({ FISCAL_HTTPS_PROXY: PROXY }));
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

  it('reuses the agent for the same certificate and builds another for a different one', () => {
    const p = provider({ FISCAL_HTTPS_PROXY: PROXY });
    const a = clientOptions(p, 'one').dispatcher;
    expect(clientOptions(p, 'one').dispatcher).toBe(a);
    expect(clientOptions(p, 'two').dispatcher).not.toBe(a);
    expect(ProxyAgent).toHaveBeenCalledTimes(2);
  });

  it('never logs the proxy credentials', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    provider({ FISCAL_HTTPS_PROXY: PROXY });
    const logged = warn.mock.calls.map(String).join('\n');
    expect(logged).toContain('proxy.example.com:3128');
    expect(logged).not.toMatch(/corvo:|s3cret/);
    expect(redactProxyUrl('not a url')).toBe('[invalid proxy url]');
  });

  it('only *.nfse.gov.br is a government host', () => {
    expect(isGovNfseHost('sefin.nfse.gov.br')).toBe(true);
    expect(isGovNfseHost('adn.producaorestrita.nfse.gov.br')).toBe(true);
    expect(isGovNfseHost('brasilapi.com.br')).toBe(false);
    expect(isGovNfseHost('evilnfse.gov.br')).toBe(false);
  });
});
