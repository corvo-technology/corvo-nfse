import { WooviClient } from './woovi.client';
import {
  ConnectorAuthError,
  ConnectorTransientError,
} from '../../domain/connector';

const res = (status: number) =>
  ({ ok: status >= 200 && status < 300, status }) as Response;

describe('WooviClient.checkCredentials', () => {
  it('calls an authenticated endpoint on the host of the environment, with the AppID as authorization', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200));
    await new WooviClient(fetchFn).checkCredentials('app-1', 'test');
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.woovi-sandbox.com/api/v1/charge?limit=1');
    expect(init.headers.Authorization).toBe('app-1');
    await new WooviClient(fetchFn).checkCredentials('app-1', 'live');
    expect((fetchFn.mock.calls[1] as [string])[0]).toBe(
      'https://api.woovi.com/api/v1/charge?limit=1',
    );
  });
  it.each([401, 403])(
    '%s means the credentials were refused',
    async (status) => {
      await expect(
        new WooviClient(
          jest.fn().mockResolvedValue(res(status)),
        ).checkCredentials('x', 'test'),
      ).rejects.toThrow(ConnectorAuthError);
    },
  );
  it.each([429, 500, 503])('%s is transient', async (status) => {
    await expect(
      new WooviClient(
        jest.fn().mockResolvedValue(res(status)),
      ).checkCredentials('x', 'test'),
    ).rejects.toThrow(ConnectorTransientError);
  });
  it('a network error is transient', async () => {
    await expect(
      new WooviClient(
        jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      ).checkCredentials('x', 'test'),
    ).rejects.toThrow(ConnectorTransientError);
  });
});
