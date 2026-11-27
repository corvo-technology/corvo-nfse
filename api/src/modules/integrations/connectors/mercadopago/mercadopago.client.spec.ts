import { MercadoPagoClient } from './mercadopago.client';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
} from '../../domain/connector';

const answer = (status: number, body: unknown = {}) =>
  jest.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
const clientWith = (fetchFn: jest.Mock) =>
  new MercadoPagoClient(fetchFn as unknown as typeof fetch);

describe('MercadoPagoClient', () => {
  it('reads a payment with the token in the Authorization header only', async () => {
    const fetchFn = answer(200, { id: 1, status: 'approved' });
    await expect(clientWith(fetchFn).getPayment('tok', '1')).resolves.toEqual({
      id: 1,
      status: 'approved',
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payments/1');
    expect(url).not.toContain('tok');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });
  it('encodes the payment id', async () => {
    const fetchFn = answer(200, {});
    await clientWith(fetchFn).getPayment('tok', 'a/b');
    expect((fetchFn.mock.calls[0] as [string])[0]).toContain('a%2Fb');
  });
  it('names the account by its user id', async () => {
    await expect(
      clientWith(answer(200, { id: 44444 })).getUserId('tok'),
    ).resolves.toBe('44444');
    await expect(clientWith(answer(200, {})).getUserId('tok')).rejects.toThrow(
      ConnectorDataError,
    );
  });
  it.each([[401], [403]])('%s is an auth error', async (status) => {
    await expect(clientWith(answer(status)).getPayment('t', '1')).rejects.toThrow(
      ConnectorAuthError,
    );
  });
  it.each([[429], [500], [503]])('%s is transient', async (status) => {
    await expect(clientWith(answer(status)).getPayment('t', '1')).rejects.toThrow(
      ConnectorTransientError,
    );
  });
  it('a payment not found yet is transient, other 4xx is a data error', async () => {
    await expect(clientWith(answer(404)).getPayment('t', '1')).rejects.toThrow(
      ConnectorTransientError,
    );
    await expect(clientWith(answer(400)).getPayment('t', '1')).rejects.toThrow(
      ConnectorDataError,
    );
    await expect(clientWith(answer(404)).getUserId('t')).rejects.toThrow(
      ConnectorDataError,
    );
  });
  it('a network failure is transient and does not leak the token', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('boom tok'));
    await expect(clientWith(fetchFn).getPayment('tok', '1')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('tok') as string,
      }) as Error,
    );
  });
});
