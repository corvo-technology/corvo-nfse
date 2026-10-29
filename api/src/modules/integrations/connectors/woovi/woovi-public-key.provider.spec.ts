import { WooviPublicKeyProvider } from './woovi-public-key.provider';
import { ConnectorTransientError } from '../../domain/connector';

const response = (keys: string[], ok = true) =>
  ({
    ok,
    status: ok ? 200 : 503,
    json: () =>
      Promise.resolve({
        public_keys: keys.map((key) => ({
          key,
          key_identifier: key,
          is_current: true,
        })),
      }),
  }) as unknown as Response;

describe('WooviPublicKeyProvider', () => {
  it('fetches from the production host for live and the sandbox host for test', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(['K']));
    const provider = new WooviPublicKeyProvider(fetchFn);
    await provider.getKeys('live');
    await provider.getKeys('test');
    expect(fetchFn.mock.calls.map((c) => (c as [string])[0])).toEqual([
      'https://api.woovi.com/api/v1/webhook/public-keys',
      'https://api.woovi-sandbox.com/api/v1/webhook/public-keys',
    ]);
  });
  it('caches for one hour per environment', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(['K']));
    let now = 1_000_000;
    const provider = new WooviPublicKeyProvider(fetchFn, () => now);
    await provider.getKeys('live');
    now += 59 * 60_000;
    await provider.getKeys('live');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await provider.getKeys('live');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('a forced refresh is rate limited to once per 30 seconds', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(['K']));
    let now = 1_000_000;
    const provider = new WooviPublicKeyProvider(fetchFn, () => now);
    await provider.getKeys('live');
    now += 10_000;
    await provider.getKeys('live', true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 31_000;
    await provider.getKeys('live', true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('serves the stale list when the refresh fails', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(response(['K']))
      .mockRejectedValueOnce(new Error('down'));
    let now = 1_000_000;
    const provider = new WooviPublicKeyProvider(fetchFn, () => now);
    await provider.getKeys('live');
    now += 2 * 3_600_000;
    await expect(provider.getKeys('live')).resolves.toEqual(['K']);
  });
  it('fails as transient when there is nothing cached and the fetch fails', async () => {
    const provider = new WooviPublicKeyProvider(
      jest.fn().mockResolvedValue(response([], false)),
    );
    await expect(provider.getKeys('live')).rejects.toThrow(
      ConnectorTransientError,
    );
  });
});
