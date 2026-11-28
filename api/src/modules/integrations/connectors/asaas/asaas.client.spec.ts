import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AsaasClient } from './asaas.client';
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
const customerFixture: unknown = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'customer.json'), 'utf8'),
);

describe('AsaasClient.getCustomer', () => {
  it('asks /v3/customers/{id} with the key in the access_token header and maps the customer', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200, customerFixture));
    const customer = await new AsaasClient(fetchFn).getCustomer(
      'fake_key',
      'live',
      'cus_000005401844',
    );
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.asaas.com/v3/customers/cus_000005401844');
    expect(init.headers.access_token).toBe('fake_key');
    expect(init.headers['User-Agent']).toBeTruthy();
    expect(customer).toEqual({
      name: 'John Doe',
      email: 'john.doe@asaas.com.br',
      cpfCnpj: '24971563792',
      address: {
        street: 'Av. Paulista, 150, Sala 201, Centro',
        city: 'São Paulo',
        state: 'SP',
        zip: '01310000',
      },
    });
  });

  it('uses the sandbox host for a test connection', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200, customerFixture));
    await new AsaasClient(fetchFn).getCustomer('k', 'test', 'cus_1');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      'https://api-sandbox.asaas.com/v3/customers/cus_1',
    );
  });

  it('leaves out a place without a city or with a state that is not two letters, and a short zip', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        res(200, { name: 'A', state: 'São Paulo', postalCode: '123' }),
      );
    const customer = await new AsaasClient(fetchFn).getCustomer(
      'k',
      'live',
      'c',
    );
    expect(customer.address).toEqual({});
    expect(customer.cpfCnpj).toBeNull();
  });

  it.each([401, 403])('%s means the key was refused', async (status) => {
    await expect(
      new AsaasClient(jest.fn().mockResolvedValue(res(status))).getCustomer(
        'k',
        'live',
        'c',
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });
  it.each([429, 500, 503])('%s is transient', async (status) => {
    await expect(
      new AsaasClient(jest.fn().mockResolvedValue(res(status))).getCustomer(
        'k',
        'live',
        'c',
      ),
    ).rejects.toThrow(ConnectorTransientError);
  });
  it('a network error is transient and 404 is a data error', async () => {
    await expect(
      new AsaasClient(
        jest.fn().mockRejectedValue(new Error('reset')),
      ).getCustomer('k', 'live', 'c'),
    ).rejects.toThrow(ConnectorTransientError);
    await expect(
      new AsaasClient(jest.fn().mockResolvedValue(res(404))).getCustomer(
        'k',
        'live',
        'c',
      ),
    ).rejects.toThrow(ConnectorDataError);
  });
  it('never puts the key in an error message', async () => {
    const error = await new AsaasClient(jest.fn().mockResolvedValue(res(401)))
      .getCustomer('fake_secret_key', 'live', 'c')
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain('fake_secret_key');
  });
});

describe('AsaasClient.checkCredentials', () => {
  it('lists one customer to prove the key works', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200, { data: [] }));
    await new AsaasClient(fetchFn).checkCredentials('k', 'live');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      'https://api.asaas.com/v3/customers?limit=1',
    );
  });
  it('a refused key throws an auth error', async () => {
    await expect(
      new AsaasClient(jest.fn().mockResolvedValue(res(401))).checkCredentials(
        'k',
        'live',
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });
});
