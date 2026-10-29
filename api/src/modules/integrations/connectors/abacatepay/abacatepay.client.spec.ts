import { AbacatePayClient } from './abacatepay.client';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
} from '../../domain/connector';

const res = (status: number, body: unknown = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

describe('AbacatePayClient.checkCredentials', () => {
  it('lists one customer with the key as bearer token', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200));
    await new AbacatePayClient(fetchFn).checkCredentials('abc_key');
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.abacatepay.com/v2/customers/list?limit=1');
    expect(init.headers.Authorization).toBe('Bearer abc_key');
  });
  it.each([401, 403])('%s means the key was refused', async (status) => {
    await expect(
      new AbacatePayClient(
        jest.fn().mockResolvedValue(res(status)),
      ).checkCredentials('k'),
    ).rejects.toThrow(ConnectorAuthError);
  });
  it.each([429, 500])('%s is transient', async (status) => {
    await expect(
      new AbacatePayClient(
        jest.fn().mockResolvedValue(res(status)),
      ).checkCredentials('k'),
    ).rejects.toThrow(ConnectorTransientError);
  });
});

describe('AbacatePayClient.getCustomer', () => {
  it('returns the customer with the full document', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      res(200, {
        data: {
          id: 'cust_1',
          name: 'Maria',
          email: 'm@x.com',
          taxId: '52998224725',
        },
      }),
    );
    await expect(
      new AbacatePayClient(fetchFn).getCustomer('k', 'cust_1'),
    ).resolves.toEqual({
      name: 'Maria',
      email: 'm@x.com',
      taxId: '52998224725',
    });
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/customers/get?id=cust_1',
    );
  });
  it('401 is an auth error, 5xx and network errors are transient, 404 is a data error', async () => {
    const run = (r: Promise<Response>) =>
      new AbacatePayClient(jest.fn().mockReturnValue(r)).getCustomer('k', 'c');
    await expect(run(Promise.resolve(res(401)))).rejects.toThrow(
      ConnectorAuthError,
    );
    await expect(run(Promise.resolve(res(503)))).rejects.toThrow(
      ConnectorTransientError,
    );
    await expect(run(Promise.reject(new Error('reset')))).rejects.toThrow(
      ConnectorTransientError,
    );
    await expect(run(Promise.resolve(res(404)))).rejects.toThrow(
      ConnectorDataError,
    );
  });
  it('encodes the customer id', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(res(200, { data: { taxId: null } }));
    await new AbacatePayClient(fetchFn).getCustomer('k', 'a&b');
    expect((fetchFn.mock.calls[0] as [string])[0]).toContain('id=a%26b');
  });
});

describe('AbacatePayClient.getProductName', () => {
  it('returns the product name, asking by id with the key', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        res(200, { data: { id: 'prod_1', name: 'Plano Pro' } }),
      );
    await expect(
      new AbacatePayClient(fetchFn).getProductName('k', 'prod_1'),
    ).resolves.toBe('Plano Pro');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      'https://api.abacatepay.com/v2/products/get?id=prod_1',
    );
  });
  it('is null when the product has no name', async () => {
    await expect(
      new AbacatePayClient(
        jest.fn().mockResolvedValue(res(200, { data: {} })),
      ).getProductName('k', 'p'),
    ).resolves.toBeNull();
  });
  it('401/403 are auth errors and 5xx transient', async () => {
    await expect(
      new AbacatePayClient(
        jest.fn().mockResolvedValue(res(403)),
      ).getProductName('k', 'p'),
    ).rejects.toThrow(ConnectorAuthError);
    await expect(
      new AbacatePayClient(
        jest.fn().mockResolvedValue(res(503)),
      ).getProductName('k', 'p'),
    ).rejects.toThrow(ConnectorTransientError);
  });
});
