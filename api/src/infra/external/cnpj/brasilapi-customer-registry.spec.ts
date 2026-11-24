import { BrasilApiCustomerRegistry } from './brasilapi-customer-registry';

const response = (status: number, json: unknown) =>
  Promise.resolve({
    ok: status === 200,
    status,
    json: () => Promise.resolve(json),
  });
const body = {
  razao_social: 'ACME COMERCIO LTDA',
  nome_fantasia: 'Acme',
  municipio: 'SAO PAULO',
  uf: 'sp',
  email: 'x@acme.com',
};

describe('BrasilApiCustomerRegistry', () => {
  it('maps name, city and state and never the email', async () => {
    const fetchFn = jest.fn().mockReturnValue(response(200, body));
    const registry = new BrasilApiCustomerRegistry({ fetchFn });
    await expect(registry.lookup('11.222.333/0001-81')).resolves.toEqual({
      name: 'ACME COMERCIO LTDA',
      city: 'SAO PAULO',
      state: 'SP',
    });
    expect((fetchFn.mock.calls as unknown[][])[0]?.[0]).toBe(
      'https://brasilapi.com.br/api/cnpj/v1/11222333000181',
    );
  });

  it('caches for 24 hours', async () => {
    let now = 0;
    const fetchFn = jest.fn().mockImplementation(() => response(200, body));
    const registry = new BrasilApiCustomerRegistry({
      fetchFn,
      now: () => now,
    });
    await registry.lookup('11222333000181');
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = 25 * 3600_000;
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('answers null when the registry does not know the CNPJ, answers badly or fails', async () => {
    const lookup = (fetchFn: jest.Mock) =>
      new BrasilApiCustomerRegistry({ fetchFn }).lookup('11222333000181');
    await expect(
      lookup(jest.fn().mockReturnValue(response(404, {}))),
    ).resolves.toBeNull();
    await expect(
      lookup(jest.fn().mockReturnValue(response(200, { uf: 'SP' }))),
    ).resolves.toBeNull();
    await expect(
      lookup(jest.fn().mockRejectedValue(new Error('down'))),
    ).resolves.toBeNull();
  });

  it('gives up after the timeout', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      );
    await expect(
      new BrasilApiCustomerRegistry({ fetchFn, timeoutMs: 10 }).lookup(
        '11222333000181',
      ),
    ).resolves.toBeNull();
  });
});
