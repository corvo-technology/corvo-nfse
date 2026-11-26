import { StripeClient } from './stripe.client';
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
const urlOf = (fetchFn: jest.Mock) => (fetchFn.mock.calls[0] as [string])[0];

describe('StripeClient.getAccountId', () => {
  it('asks /v1/account with the key as bearer token and returns the acct id', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200, { id: 'acct_1ABC' }));
    await expect(
      new StripeClient(fetchFn).getAccountId('rk_fake_key'),
    ).resolves.toBe('acct_1ABC');
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.stripe.com/v1/account');
    expect(init.headers.Authorization).toBe('Bearer rk_fake_key');
  });
  it('an answer without an id is a data error', async () => {
    await expect(
      new StripeClient(jest.fn().mockResolvedValue(res(200, {}))).getAccountId(
        'k',
      ),
    ).rejects.toThrow(ConnectorDataError);
  });
  it.each([401, 403])('%s means the key was refused', async (status) => {
    await expect(
      new StripeClient(jest.fn().mockResolvedValue(res(status))).getAccountId(
        'k',
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });
  it.each([429, 500, 503])('%s is transient', async (status) => {
    await expect(
      new StripeClient(jest.fn().mockResolvedValue(res(status))).getAccountId(
        'k',
      ),
    ).rejects.toThrow(ConnectorTransientError);
  });
  it('a network error is transient and 404 is a data error', async () => {
    await expect(
      new StripeClient(
        jest.fn().mockRejectedValue(new Error('reset')),
      ).getAccountId('k'),
    ).rejects.toThrow(ConnectorTransientError);
    await expect(
      new StripeClient(jest.fn().mockResolvedValue(res(404))).getAccountId('k'),
    ).rejects.toThrow(ConnectorDataError);
  });
  it('never puts the key in an error message', async () => {
    const error = await new StripeClient(jest.fn().mockResolvedValue(res(401)))
      .getAccountId('rk_fake_secret')
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain('rk_fake_secret');
  });
});

describe('StripeClient.getCustomer', () => {
  it('returns name, e-mail and tax ids, expanding the tax ids', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      res(200, {
        name: 'Maria',
        email: 'm@x.com',
        tax_ids: {
          data: [
            { type: 'br_cpf', value: '529.982.247-25' },
            { type: 'eu_vat', value: 'DE1' },
            { type: 5 },
          ],
        },
      }),
    );
    await expect(
      new StripeClient(fetchFn).getCustomer('k', 'cus_1'),
    ).resolves.toEqual({
      name: 'Maria',
      email: 'm@x.com',
      taxIds: [
        { type: 'br_cpf', value: '529.982.247-25' },
        { type: 'eu_vat', value: 'DE1' },
      ],
    });
    expect(urlOf(fetchFn)).toBe(
      'https://api.stripe.com/v1/customers/cus_1?expand[]=tax_ids',
    );
  });
  it('a bare customer has nulls and no tax ids; the id is encoded', async () => {
    const fetchFn = jest.fn().mockResolvedValue(res(200, {}));
    await expect(
      new StripeClient(fetchFn).getCustomer('k', 'a&b'),
    ).resolves.toEqual({ name: null, email: null, taxIds: [] });
    expect(urlOf(fetchFn)).toContain('/v1/customers/a%26b');
  });
});

describe('StripeClient.findCheckoutSession', () => {
  it('finds the session of a payment intent with its tax ids and the first lines', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      res(200, {
        data: [
          {
            customer_details: {
              tax_ids: [{ type: 'br_cnpj', value: '11.222.333/0001-81' }],
            },
            line_items: {
              data: [
                {
                  description: 'Plano Pro',
                  quantity: 2,
                  price: { product: 'prod_1' },
                },
                { description: ' ', quantity: 0 },
                { description: 'Extra', quantity: 1 },
              ],
            },
          },
        ],
      }),
    );
    await expect(
      new StripeClient(fetchFn).findCheckoutSession('k', 'pi_1', 2),
    ).resolves.toEqual({
      taxIds: [{ type: 'br_cnpj', value: '11.222.333/0001-81' }],
      lines: [
        { description: 'Plano Pro', quantity: 2, productId: 'prod_1' },
        { description: null, quantity: 1, productId: null },
      ],
    });
    expect(urlOf(fetchFn)).toBe(
      'https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_1&limit=1&expand[]=data.line_items',
    );
  });
  it('is null when the payment did not come from Checkout', async () => {
    await expect(
      new StripeClient(
        jest.fn().mockResolvedValue(res(200, { data: [] })),
      ).findCheckoutSession('k', 'pi_1', 5),
    ).resolves.toBeNull();
  });
  it('403 is an auth error and 5xx transient', async () => {
    await expect(
      new StripeClient(
        jest.fn().mockResolvedValue(res(403)),
      ).findCheckoutSession('k', 'pi', 5),
    ).rejects.toThrow(ConnectorAuthError);
    await expect(
      new StripeClient(
        jest.fn().mockResolvedValue(res(502)),
      ).findCheckoutSession('k', 'pi', 5),
    ).rejects.toThrow(ConnectorTransientError);
  });
});

describe('StripeClient.getInvoiceLines', () => {
  it('returns the invoice lines up to the limit', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      res(200, {
        lines: {
          data: [
            { description: 'Assinatura', quantity: 1 },
            { description: 'Outro', quantity: 1 },
          ],
        },
      }),
    );
    await expect(
      new StripeClient(fetchFn).getInvoiceLines('k', 'in_1', 1),
    ).resolves.toEqual([
      { description: 'Assinatura', quantity: 1, productId: null },
    ]);
    expect(urlOf(fetchFn)).toBe('https://api.stripe.com/v1/invoices/in_1');
  });
});
