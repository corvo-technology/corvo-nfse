import { ProxyAgent } from 'undici';
import {
  GOV_FISCAL_HOSTS,
  GovProxyDispatchers,
  certificateCacheKey,
  isGovFiscalHost,
  probeViaProxy,
  redactProxyUrl,
} from './gov-proxy';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((options: unknown) => ({
    options,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PROXY = 'http://corvo:s3cret@proxy.example.com:3128';
const pem = { keyPem: 'K', certPem: 'C' };

describe('government host allowlist', () => {
  it('accepts the SEFAZ and NFS-e hosts, compared exactly', () => {
    expect(isGovFiscalHost('nfe.fazenda.sp.gov.br')).toBe(true);
    expect(isGovFiscalHost('NFE.FAZENDA.SP.GOV.BR')).toBe(true);
    expect(isGovFiscalHost('sefin.nfse.gov.br')).toBe(true);
    expect(isGovFiscalHost('adn.producaorestrita.nfse.gov.br')).toBe(true);
  });

  it('refuses look-alikes, suffixes and unrelated hosts', () => {
    expect(isGovFiscalHost('evil.gov.br.example.com')).toBe(false);
    expect(isGovFiscalHost('x.nfe.fazenda.sp.gov.br')).toBe(false);
    expect(isGovFiscalHost('evilsefin.nfse.gov.br')).toBe(false);
    expect(isGovFiscalHost('brasilapi.com.br')).toBe(false);
    expect(isGovFiscalHost('')).toBe(false);
  });

  it('includes the SVC hosts', () => {
    expect([...GOV_FISCAL_HOSTS].some((h) => h.includes('svc'))).toBe(true);
  });
});

describe('redactProxyUrl', () => {
  it('hides credentials', () => {
    expect(redactProxyUrl('http://u:p@h:3128')).toBe('http://***@h:3128');
    expect(redactProxyUrl('http://h:3128')).toBe('http://h:3128');
    expect(redactProxyUrl('not a url')).toBe('[invalid proxy url]');
  });
});

describe('GovProxyDispatchers', () => {
  beforeEach(() => (ProxyAgent as unknown as jest.Mock).mockClear());

  it('keeps the client certificate in requestTls and never disables verification', () => {
    new GovProxyDispatchers(PROXY).for('a', pem, 'CA');
    const options = (ProxyAgent as unknown as jest.Mock).mock.calls[0][0] as {
      uri: string;
      requestTls: Record<string, unknown>;
    };
    expect(options.uri).toBe(PROXY);
    expect(options.requestTls).toEqual({
      key: 'K',
      cert: 'C',
      ca: 'CA',
      ALPNProtocols: ['http/1.1'],
    });
    expect(options.requestTls).not.toHaveProperty('rejectUnauthorized');
  });

  it('reuses the agent per key and builds another for a different one', () => {
    const d = new GovProxyDispatchers(PROXY);
    const a = d.for('a', pem);
    expect(d.for('a', pem)).toBe(a);
    expect(d.for('b', pem)).not.toBe(a);
    expect(ProxyAgent).toHaveBeenCalledTimes(2);
  });

  it('closes the oldest agent past 32', () => {
    const d = new GovProxyDispatchers(PROXY);
    const first = d.for('0', pem) as unknown as { close: jest.Mock };
    for (let i = 1; i <= 32; i++) d.for(String(i), pem);
    expect(first.close).toHaveBeenCalled();
  });

  it('keys by scope and certificate', () => {
    expect(certificateCacheKey('nfse', 'C1')).not.toBe(
      certificateCacheKey('sefaz', 'C1'),
    );
    expect(certificateCacheKey('nfse', 'C1')).not.toBe(
      certificateCacheKey('nfse', 'C2'),
    );
  });
});

describe('probeViaProxy', () => {
  it('does not even try a host outside the allowlist', async () => {
    await expect(probeViaProxy(PROXY, 'example.com')).resolves.toBe(false);
  });

  it('is false when the proxy cannot be reached', async () => {
    await expect(
      probeViaProxy('http://127.0.0.1:1', 'sefin.nfse.gov.br', 1_000),
    ).resolves.toBe(false);
  });
});
