import { NfseClient, TooManyRequestsError } from 'open-nfse';
import { PortalUnavailableError } from '@/modules/invoice/application/fiscal-portal-breaker';
import { OpenNfseProvider } from './open-nfse.provider';
import type { IIssuePayload } from './nfse-fiscal-provider';

const credentials = (environment: 'live' | 'test') =>
  ({
    environment,
    pfxBuffer: Buffer.from('pfx'),
    p12Password: 'secret',
  }) as IIssuePayload;

function build() {
  const limiter = {
    acquire: jest.fn().mockResolvedValue(undefined),
    noteError: jest.fn().mockResolvedValue(undefined),
  };
  const provider = new OpenNfseProvider(
    {} as never,
    { get: () => undefined } as never,
    undefined,
    limiter as never,
  );
  return { provider, limiter };
}

afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider: every government call goes through the rate limit', () => {
  it('takes one token per call, per host and environment', async () => {
    const { provider, limiter } = build();
    jest
      .spyOn(NfseClient.prototype, 'fetchByNsu')
      .mockResolvedValue({} as never);
    await provider.fetchPortalDocuments(credentials('live'), 'live', 0);
    await provider.fetchPortalDocuments(credentials('test'), 'test', 0);
    expect(limiter.acquire.mock.calls).toEqual([
      ['adn:production'],
      ['adn:restricted'],
    ]);
  });

  it('takes a token for each of the two calls of a DPS lookup', async () => {
    const { provider, limiter } = build();
    jest
      .spyOn(NfseClient.prototype, 'fetchDpsStatus')
      .mockRejectedValue(new Error('stop'));
    await expect(
      provider.queryByDps('DPS1', credentials('live')),
    ).rejects.toThrow('stop');
    expect(limiter.acquire).toHaveBeenCalledWith('sefin:production');
  });

  it('does not call the portal when the limiter hands the job back', async () => {
    const { provider, limiter } = build();
    limiter.acquire.mockRejectedValue(new PortalUnavailableError(new Date()));
    const fetch = jest
      .spyOn(NfseClient.prototype, 'fetchByNsu')
      .mockResolvedValue({} as never);
    await expect(
      provider.fetchPortalDocuments(credentials('live'), 'live', 0),
    ).rejects.toBeInstanceOf(PortalUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a 429 from the portal so every replica pauses the host', async () => {
    const { provider, limiter } = build();
    const tooMany = new TooManyRequestsError('slow down', {
      headers: { 'retry-after': '20' },
    });
    jest.spyOn(NfseClient.prototype, 'fetchByNsu').mockRejectedValue(tooMany);
    await expect(
      provider.fetchPortalDocuments(credentials('live'), 'live', 0),
    ).rejects.toBe(tooMany);
    expect(limiter.noteError).toHaveBeenCalledWith('adn:production', tooMany);
  });

  it('works without a limiter (tests and tools)', async () => {
    const provider = new OpenNfseProvider(
      {} as never,
      { get: () => undefined } as never,
    );
    jest
      .spyOn(NfseClient.prototype, 'fetchByNsu')
      .mockResolvedValue({ ok: true } as never);
    await expect(
      provider.fetchPortalDocuments(credentials('live'), 'live', 0),
    ).resolves.toEqual({ ok: true });
  });
});
