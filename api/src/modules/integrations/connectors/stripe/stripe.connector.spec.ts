import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StripeConnector } from './stripe.connector';
import type { StripeClient } from './stripe.client';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

/** The parts of a fixture event the tests change. */
interface FixtureEvent {
  id?: string;
  livemode?: boolean;
  account?: string;
  data: { object: Record<string, unknown> };
}

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const SIGNING = 'whsec_fake_signing_secret_for_tests';
const URL_SECRET = 'S3CRET-0123456789';
const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'acct_1ABC',
  credentials: { webhookSecret: URL_SECRET, webhookSigningSecret: SIGNING },
};
const now = () => Math.floor(Date.now() / 1000);
const sign = (body: string, t: number, key = SIGNING) =>
  createHmac('sha256', key).update(`${t}.${body}`).digest('hex');
const req = (
  body: string,
  over: { secret?: string | null; header?: string | null; t?: number } = {},
) => {
  const t = over.t ?? now();
  const header =
    over.header === undefined ? `t=${t},v1=${sign(body, t)}` : over.header;
  return {
    rawBody: Buffer.from(body),
    headers: header === null ? {} : { 'stripe-signature': header },
    query:
      over.secret === null ? {} : { webhookSecret: over.secret ?? URL_SECRET },
  };
};
const edit = (name: string, change: (event: FixtureEvent) => void) => {
  const event = JSON.parse(fixture(name)) as FixtureEvent;
  change(event);
  return JSON.stringify(event);
};

describe('StripeConnector.authenticate', () => {
  const body = fixture('charge-succeeded');
  const connector = new StripeConnector();
  const auth = (r: ReturnType<typeof req>) =>
    connector.authenticate(r, connection);

  it('accepts the right URL secret with a valid signature', async () => {
    await expect(auth(req(body))).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing URL secret even with a valid signature', async () => {
    await expect(auth(req(body, { secret: 'wrong' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
    await expect(auth(req(body, { secret: null }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
  });
  it('rejects a missing signature header and a tampered signature', async () => {
    await expect(auth(req(body, { header: null }))).resolves.toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    await expect(
      auth(req(body, { header: `t=${now()},v1=${'0'.repeat(64)}` })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a body altered by one byte', async () => {
    const t = now();
    const request = req(body, { t });
    request.rawBody = Buffer.from(body + ' ');
    await expect(auth(request)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('rejects a signature made with another signing secret', async () => {
    const t = now();
    await expect(
      auth(req(body, { header: `t=${t},v1=${sign(body, t, 'whsec_other')}` })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('accepts when any of several v1 signatures matches', async () => {
    const t = now();
    await expect(
      auth(
        req(body, {
          header: `t=${t},v1=${'a'.repeat(64)},v0=zzz,v1=${sign(body, t)}`,
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a timestamp more than 300 seconds off, old or in the future, even if the signature is right', async () => {
    for (const offset of [-301, 301]) {
      const t = now() + offset;
      await expect(auth(req(body, { t }))).resolves.toEqual({
        ok: false,
        reason: 'stale_timestamp',
      });
    }
    const t = now() - 299;
    await expect(auth(req(body, { t }))).resolves.toEqual({ ok: true });
  });
  it('rejects a header without a usable timestamp or signature', async () => {
    for (const header of ['v1=abc', `t=abc,v1=${sign(body, 1)}`, `t=${now()}`])
      await expect(auth(req(body, { header }))).resolves.toEqual({
        ok: false,
        reason: 'bad_signature',
      });
  });
  it('rejects when the connection has no signing secret', async () => {
    await expect(
      connector.authenticate(req(body), {
        ...connection,
        credentials: { webhookSecret: URL_SECRET },
      }),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('uses a constant-time comparison', async () => {
    const crypto =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    await auth(req(body));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('never puts a secret in the rejection reason', async () => {
    const result = await auth(req(body, { secret: URL_SECRET + 'x' }));
    expect(JSON.stringify(result)).not.toContain('S3CRET');
    expect(JSON.stringify(result)).not.toContain('whsec_');
  });
});

describe('StripeConnector.parse', () => {
  const connector = new StripeConnector();
  const parse = (body: string) => connector.parse(req(body));

  it('a paid charge is an operation keyed by the event id, with the environment from livemode', () => {
    expect(parse(fixture('charge-succeeded'))).toEqual({
      kind: 'operation',
      deliveryId: 'evt_1SucceededAAA',
      externalType: 'charge.succeeded',
      environment: 'live',
    });
    expect(
      parse(edit('charge-succeeded', (e) => (e.livemode = false))),
    ).toMatchObject({ environment: 'test' });
  });
  it('a total refund and a dispute are operations', () => {
    expect(parse(fixture('charge-refunded'))).toMatchObject({
      kind: 'operation',
      deliveryId: 'evt_1RefundedBBB',
    });
    expect(parse(fixture('charge-dispute-created'))).toMatchObject({
      kind: 'operation',
      externalType: 'charge.dispute.created',
    });
  });
  it('a partial refund is ignored', () => {
    expect(
      parse(
        edit('charge-refunded', (e) => {
          e.data.object.refunded = false;
          e.data.object.amount_refunded = 2500;
        }),
      ),
    ).toEqual({ kind: 'ignored', externalType: 'charge.refunded' });
  });
  it.each([
    ['pending', { status: 'pending', paid: false }],
    ['failed', { status: 'failed', paid: false }],
    ['unpaid but succeeded', { status: 'succeeded', paid: false }],
    ['paid but not succeeded', { status: 'pending', paid: true }],
  ])('a charge.succeeded that is %s is ignored', (_label, over) => {
    expect(
      parse(
        edit('charge-succeeded', (e) => Object.assign(e.data.object, over)),
      ),
    ).toEqual({ kind: 'ignored', externalType: 'charge.succeeded' });
  });
  it.each([
    'checkout.session.completed',
    'invoice.paid',
    'payment_intent.succeeded',
    'charge.failed',
    'charge.dispute.closed',
  ])('%s is ignored', (type) => {
    expect(
      parse(JSON.stringify({ id: 'evt_x', type, data: { object: {} } })),
    ).toEqual({ kind: 'ignored', externalType: type });
  });
  it('a body without a type is the transport test', () => {
    expect(parse('{}')).toEqual({ kind: 'test' });
  });
  it('an operation event without an id is unreadable, and so is invalid JSON', () => {
    expect(() => parse(edit('charge-succeeded', (e) => delete e.id))).toThrow(
      ConnectorDataError,
    );
    expect(() => parse('nope')).toThrow();
  });
  it('passes the connected account through when the event names one', () => {
    expect(
      parse(edit('charge-succeeded', (e) => (e.account = 'acct_other'))),
    ).toMatchObject({ externalAccountId: 'acct_other' });
  });
});

describe('StripeConnector.normalize', () => {
  const connector = new StripeConnector();
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const run = (body: string) =>
    connector.normalize({ connection, payload: body, delivery });

  it('maps a paid charge from the billing details, with no lookups without a key', async () => {
    await expect(run(fixture('charge-succeeded'))).resolves.toEqual({
      operationKey: 'stripe_charge:ch_3SabcdefGHIJ',
      commercialState: 'paid',
      externalRefs: {
        chargeId: 'ch_3SabcdefGHIJ',
        paymentIntentId: 'pi_3SabcdefGHIJ',
      },
      occurredAt: new Date(1793285990 * 1000),
      paidAt: new Date(1793285990 * 1000),
      currency: 'BRL',
      amountCents: 10000,
      discountCents: 0,
      customer: {
        name: 'Maria da Silva',
        email: 'maria@example.com',
        taxId: null,
        taxIdMasked: false,
      },
      items: [],
      description: null,
      sellerIssuesInvoice: true,
    });
  });
  it('a full refund shares the operation key of the payment', async () => {
    const paid = await run(fixture('charge-succeeded'));
    const refunded = await run(fixture('charge-refunded'));
    expect(refunded.operationKey).toBe(paid.operationKey);
    expect(refunded.commercialState).toBe('refunded');
    expect(refunded.occurredAt).toEqual(new Date(1793289600 * 1000));
  });
  it('a dispute names the charge it refers to and has no sale data of its own', async () => {
    const dispute = await run(fixture('charge-dispute-created'));
    expect(dispute).toMatchObject({
      operationKey: 'stripe_charge:ch_3SabcdefGHIJ',
      commercialState: 'disputed',
      refersTo: { ref: 'chargeId', value: 'ch_3SabcdefGHIJ' },
      externalRefs: { chargeId: 'ch_3SabcdefGHIJ' },
      customer: null,
    });
    const paid = await run(fixture('charge-succeeded'));
    expect(paid.externalRefs.chargeId).toBe(dispute.refersTo?.value);
  });
  it('keeps the real currency so the planner can block anything but BRL', async () => {
    const op = await run(
      edit('charge-succeeded', (e) => (e.data.object.currency = 'usd')),
    );
    expect(op.currency).toBe('USD');
  });
  it.each([[100.5], ['10000'], [0], [-1], [null]])(
    'refuses an amount that is not a positive integer of cents (%s)',
    async (amount) => {
      await expect(
        run(edit('charge-succeeded', (e) => (e.data.object.amount = amount))),
      ).rejects.toThrow(ConnectorDataError);
    },
  );
  it('refuses a dispute with no charge and an event that is not a charge event', async () => {
    await expect(
      run(edit('charge-dispute-created', (e) => delete e.data.object.charge)),
    ).rejects.toThrow(ConnectorDataError);
    await expect(
      run(JSON.stringify({ id: 'x', type: 'invoice.paid', data: {} })),
    ).rejects.toThrow(ConnectorDataError);
  });
  it('a charge with no billing details and no key has no customer', async () => {
    const op = await run(
      edit('charge-succeeded', (e) => {
        e.data.object.billing_details = null;
        e.data.object.customer = null;
      }),
    );
    expect(op.customer).toBeNull();
  });
});

describe('StripeConnector.normalize with a restricted key', () => {
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const keyed: ConnectionView = {
    ...connection,
    credentials: { ...connection.credentials, apiKey: 'rk_fake_key' },
  };
  const make = (client: Partial<Record<keyof StripeClient, jest.Mock>>) =>
    new StripeConnector({
      getCustomer: jest
        .fn()
        .mockResolvedValue({ name: null, email: null, taxIds: [] }),
      findCheckoutSession: jest.fn().mockResolvedValue(null),
      getInvoiceLines: jest.fn().mockResolvedValue([]),
      ...client,
    } as unknown as StripeClient);
  const run = (c: StripeConnector, body = fixture('charge-succeeded')) =>
    c.normalize({ connection: keyed, payload: body, delivery });

  it('takes the CPF from the customer tax ids and normalizes it', async () => {
    const getCustomer = jest.fn().mockResolvedValue({
      name: 'Maria',
      email: 'm@x.com',
      taxIds: [
        { type: 'eu_vat', value: 'DE123' },
        { type: 'br_cpf', value: '529.982.247-25' },
      ],
    });
    const op = await run(make({ getCustomer }));
    expect(getCustomer).toHaveBeenCalledWith('rk_fake_key', 'cus_Maria1');
    expect(op.customer).toEqual({
      name: 'Maria da Silva',
      email: 'maria@example.com',
      taxId: '52998224725',
      taxIdMasked: false,
    });
  });
  it('takes a CNPJ too', async () => {
    const op = await run(
      make({
        getCustomer: jest.fn().mockResolvedValue({
          name: null,
          email: null,
          taxIds: [{ type: 'br_cnpj', value: '11.222.333/0001-81' }],
        }),
      }),
    );
    expect(op.customer?.taxId).toBe('11222333000181');
  });
  it('falls back to the Customer name and e-mail when the charge has none', async () => {
    const op = await run(
      make({
        getCustomer: jest.fn().mockResolvedValue({
          name: 'Maria Cliente',
          email: 'c@x.com',
          taxIds: [],
        }),
      }),
      edit('charge-succeeded', (e) => (e.data.object.billing_details = null)),
    );
    expect(op.customer).toMatchObject({
      name: 'Maria Cliente',
      email: 'c@x.com',
      taxId: null,
    });
  });
  it('falls back to the Checkout Session tax ids when the customer has none', async () => {
    const op = await run(
      make({
        findCheckoutSession: jest.fn().mockResolvedValue({
          taxIds: [{ type: 'br_cpf', value: '52998224725' }],
          lines: [],
        }),
      }),
    );
    expect(op.customer?.taxId).toBe('52998224725');
  });
  it('a customer without a Brazilian document leaves the tax id null', async () => {
    const op = await run(
      make({
        getCustomer: jest.fn().mockResolvedValue({
          name: null,
          email: null,
          taxIds: [{ type: 'us_ein', value: '12-3456789' }],
        }),
      }),
    );
    expect(op.customer?.taxId).toBeNull();
  });
  it('names the sale after the Checkout Session items', async () => {
    const findCheckoutSession = jest.fn().mockResolvedValue({
      taxIds: [],
      lines: [
        { description: 'Plano Pro', quantity: 1, productId: 'prod_1' },
        { description: 'Extra', quantity: 2, productId: null },
        { description: 'Plano Pro', quantity: 1, productId: 'prod_1' },
      ],
    });
    const op = await run(make({ findCheckoutSession }));
    expect(findCheckoutSession).toHaveBeenCalledWith(
      'rk_fake_key',
      'pi_3SabcdefGHIJ',
      5,
    );
    expect(op.description).toBe('Plano Pro, Extra');
    expect(op.items[0]).toEqual({
      externalProductId: 'prod_1',
      description: 'Plano Pro',
      quantity: 1,
    });
  });
  it('uses the invoice lines when there is no Checkout Session', async () => {
    const getInvoiceLines = jest
      .fn()
      .mockResolvedValue([
        { description: 'Assinatura mensal', quantity: 1, productId: null },
      ]);
    const op = await run(
      make({ getInvoiceLines }),
      edit('charge-succeeded', (e) => (e.data.object.invoice = 'in_1')),
    );
    expect(getInvoiceLines).toHaveBeenCalledWith('rk_fake_key', 'in_1', 5);
    expect(op.description).toBe('Assinatura mensal');
  });
  it('does not look at the invoice when the session already described the sale', async () => {
    const getInvoiceLines = jest.fn();
    await run(
      make({
        getInvoiceLines,
        findCheckoutSession: jest.fn().mockResolvedValue({
          taxIds: [],
          lines: [{ description: 'Plano', quantity: 1, productId: null }],
        }),
      }),
      edit('charge-succeeded', (e) => (e.data.object.invoice = 'in_1')),
    );
    expect(getInvoiceLines).not.toHaveBeenCalled();
  });
  it('a key that cannot read sessions or invoices only costs the description', async () => {
    const op = await run(
      make({
        findCheckoutSession: jest
          .fn()
          .mockRejectedValue(new ConnectorAuthError('403')),
        getInvoiceLines: jest
          .fn()
          .mockRejectedValue(new ConnectorAuthError('403')),
      }),
      edit('charge-succeeded', (e) => (e.data.object.invoice = 'in_1')),
    );
    expect(op.description).toBeNull();
    expect(op.customer?.name).toBe('Maria da Silva');
  });
  it('a key refused on customers asks for a new key', async () => {
    await expect(
      run(
        make({
          getCustomer: jest
            .fn()
            .mockRejectedValue(new ConnectorAuthError('403')),
        }),
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });
  it('a customer that no longer exists does not stop the sale', async () => {
    const op = await run(
      make({
        getCustomer: jest.fn().mockRejectedValue(new ConnectorDataError('404')),
      }),
    );
    expect(op.customer?.name).toBe('Maria da Silva');
  });
  it('lets transient failures propagate so the worker retries', async () => {
    const boom = jest
      .fn()
      .mockRejectedValue(new ConnectorTransientError('503'));
    await expect(run(make({ getCustomer: boom }))).rejects.toThrow(
      ConnectorTransientError,
    );
    await expect(run(make({ findCheckoutSession: boom }))).rejects.toThrow(
      ConnectorTransientError,
    );
  });
  it('a dispute makes no lookups', async () => {
    const getCustomer = jest.fn();
    await run(make({ getCustomer }), fixture('charge-dispute-created'));
    expect(getCustomer).not.toHaveBeenCalled();
  });
});

describe('StripeConnector.validateConnection', () => {
  it('asks Stripe for the account and returns the acct id as the external account', async () => {
    const getAccountId = jest.fn().mockResolvedValue('acct_1ABC');
    const connector = new StripeConnector({
      getAccountId,
    } as unknown as StripeClient);
    await expect(
      connector.validateConnection(
        {
          apiKey: 'rk_fake_key',
          webhookSigningSecret: SIGNING,
          webhookSecret: 'x',
        },
        'live',
      ),
    ).resolves.toEqual({ externalAccountId: 'acct_1ABC' });
    expect(getAccountId).toHaveBeenCalledWith('rk_fake_key');
  });
  it('a refused key becomes an auth error', async () => {
    const connector = new StripeConnector({
      getAccountId: jest.fn().mockRejectedValue(new ConnectorAuthError('401')),
    } as unknown as StripeClient);
    await expect(
      connector.validateConnection({ apiKey: 'rk_fake_key' }, 'live'),
    ).rejects.toThrow(ConnectorAuthError);
  });
});

describe('StripeConnector.manifest', () => {
  it('declares the key and signing secret as secrets and a generated secret for the URL', () => {
    const { manifest } = new StripeConnector();
    expect(manifest).toMatchObject({
      id: 'stripe',
      supportedFlows: ['charge'],
    });
    expect(manifest.credentialFields).toEqual([
      expect.objectContaining({ key: 'apiKey', secret: true }),
      expect.objectContaining({ key: 'webhookSigningSecret', secret: true }),
      expect.objectContaining({
        key: 'webhookSecret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      }),
    ]);
    for (const events of [
      'charge.succeeded',
      'charge.refunded',
      'charge.dispute.created',
    ])
      expect(manifest.webhookInstructions.pt).toContain(events);
    expect(manifest.webhookInstructions.en).toContain('tax_id_collection');
  });
});
