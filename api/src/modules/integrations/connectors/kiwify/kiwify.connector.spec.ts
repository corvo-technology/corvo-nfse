import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KiwifyConnector } from './kiwify.connector';
import {
  ConnectorDataError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

type Body = Record<string, unknown> & {
  Customer?: Record<string, unknown>;
  Commissions?: Record<string, unknown>;
};

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const edit = (name: string, change: (body: Body) => void) => {
  const body = JSON.parse(fixture(name)) as Body;
  change(body);
  return JSON.stringify(body);
};
const TOKEN = 'kiwify-token-de-teste';
const URL_SECRET = 'S3CRET-0123456789';
const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'kiwify:abc',
  credentials: { webhookSecret: URL_SECRET, token: TOKEN },
};
const sign = (body: string, key = TOKEN) =>
  createHmac('sha1', key).update(body).digest('hex');
const req = (
  body: string,
  over: { secret?: string | null; signature?: string | null } = {},
) => ({
  rawBody: Buffer.from(body),
  headers: {},
  query: {
    ...(over.secret === null
      ? {}
      : { webhookSecret: over.secret ?? URL_SECRET }),
    ...(over.signature === null
      ? {}
      : { signature: over.signature ?? sign(body) }),
  },
});

describe('KiwifyConnector.authenticate', () => {
  const body = fixture('order-approved');
  const connector = new KiwifyConnector();
  const auth = (r: ReturnType<typeof req>, view = connection) =>
    connector.authenticate(r, view);

  it('matches the test vector from the Kiwify docs', () => {
    const docBody =
      '{"order_id":"9b1c2d3e-0000-4000-8000-000000000001","order_status":"paid","webhook_event_type":"order_approved"}';
    expect(sign(docBody)).toBe('bf18f352a4f981b91dfa3f6d8742a81080ab8c86');
  });
  it('accepts the right URL secret with a valid signature', async () => {
    await expect(auth(req(body))).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing URL secret even with a valid signature', async () => {
    for (const secret of ['wrong', null])
      await expect(auth(req(body, { secret }))).resolves.toEqual({
        ok: false,
        reason: 'bad_secret',
      });
  });
  it('rejects a missing signature and a wrong signature', async () => {
    await expect(auth(req(body, { signature: null }))).resolves.toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    await expect(
      auth(req(body, { signature: '0'.repeat(40) })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    await expect(auth(req(body, { signature: 'abc' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('rejects a body altered by one byte', async () => {
    const request = req(body);
    request.rawBody = Buffer.from(body + ' ');
    await expect(auth(request)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('signs the raw bytes, not the re-serialized JSON', async () => {
    const spaced = body.replace('{\n', '{ \n');
    await expect(auth(req(spaced))).resolves.toEqual({ ok: true });
    const request = req(body);
    request.rawBody = Buffer.from(spaced);
    await expect(auth(request)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('rejects a signature made with another token', async () => {
    await expect(
      auth(req(body, { signature: sign(body, 'other-token') })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects when the connection has no token, even for a signature made with an empty key', async () => {
    await expect(
      auth(req(body, { signature: sign(body, '') }), {
        ...connection,
        credentials: { webhookSecret: URL_SECRET },
      }),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects when the connection has no URL secret', async () => {
    await expect(
      auth(req(body, { secret: '' }), {
        ...connection,
        credentials: { token: TOKEN },
      }),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('uses a constant-time comparison and never leaks a secret in the reason', async () => {
    const crypto =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    const result = await auth(
      req(body, { secret: URL_SECRET.slice(0, -1) + 'x' }),
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(JSON.stringify(result)).not.toContain('S3CRET');
  });
});

describe('KiwifyConnector.parse', () => {
  const connector = new KiwifyConnector();
  const parse = (body: string) => connector.parse(req(body));

  it('an approved order is an operation keyed by order id and event type', () => {
    expect(parse(fixture('order-approved'))).toEqual({
      kind: 'operation',
      deliveryId: '9b1c2d3e-0000-4000-8000-000000000001:order_approved',
      externalType: 'order_approved',
    });
  });
  it('a refund and a chargeback are operations with their own delivery ids', () => {
    expect(parse(fixture('order-refunded'))).toMatchObject({
      kind: 'operation',
      deliveryId: '9b1c2d3e-0000-4000-8000-000000000001:order_refunded',
    });
    expect(parse(fixture('chargeback'))).toMatchObject({
      kind: 'operation',
      deliveryId: '9b1c2d3e-0000-4000-8000-000000000001:chargeback',
    });
  });
  it('a renewal charge has its own order id, so its own delivery', () => {
    expect(parse(fixture('subscription-order-approved'))).toMatchObject({
      deliveryId: '9b1c2d3e-0000-4000-8000-000000000002:order_approved',
    });
  });
  it.each([
    'subscription_renewed',
    'subscription_canceled',
    'subscription_late',
    'subscription_trial_started',
    'billet_created',
    'pix_created',
    'order_rejected',
  ])('%s is ignored', (type) => {
    expect(
      parse(edit('subscription-renewed', (b) => (b.webhook_event_type = type))),
    ).toEqual({ kind: 'ignored', externalType: type });
  });
  it('an event whose order_status does not match its type is ignored', () => {
    expect(
      parse(
        edit('order-approved', (b) => (b.order_status = 'waiting_payment')),
      ),
    ).toEqual({ kind: 'ignored', externalType: 'order_approved' });
  });
  it("a sale that is not the producer's own is ignored", () => {
    expect(
      parse(edit('order-approved', (b) => (b.sale_type = 'affiliate'))),
    ).toEqual({
      kind: 'ignored',
      externalType: 'order_approved:not_producer',
    });
    expect(
      parse(edit('order-approved', (b) => (b.sale_type = 'producer'))),
    ).toMatchObject({ kind: 'operation' });
  });
  it('a body without an event type is the transport test', () => {
    expect(parse('{}')).toEqual({ kind: 'test' });
  });
  it('an operation without an order id, or a body that is not JSON, is unreadable', () => {
    expect(() =>
      parse(edit('order-approved', (b) => delete b.order_id)),
    ).toThrow(ConnectorDataError);
    expect(() => parse('nope')).toThrow(ConnectorDataError);
    expect(() => parse('[]')).toThrow(ConnectorDataError);
  });
  it('does not name an environment: Kiwify has no test mode', () => {
    expect(parse(fixture('order-approved'))).not.toHaveProperty('environment');
  });
});

describe('KiwifyConnector.normalize', () => {
  const connector = new KiwifyConnector();
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const run = (body: string, credentials = connection.credentials) =>
    connector.normalize({
      connection: { ...connection, credentials },
      payload: body,
      delivery,
    });

  it('maps an approved order: total paid, buyer and product', async () => {
    await expect(run(fixture('order-approved'))).resolves.toEqual({
      operationKey: 'kiwify:9b1c2d3e-0000-4000-8000-000000000001',
      commercialState: 'paid',
      externalRefs: {
        orderId: '9b1c2d3e-0000-4000-8000-000000000001',
        orderRef: 'AbC123x',
      },
      occurredAt: new Date('2026-10-29T15:00:00-03:00'),
      paidAt: new Date('2026-10-29T15:00:00-03:00'),
      currency: 'BRL',
      amountCents: 10000,
      discountCents: 0,
      customer: {
        name: 'Maria da Silva',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
      },
      items: [
        {
          externalProductId: 'prod-0001',
          description: 'Curso de Excel',
          quantity: 1,
        },
      ],
      description: 'Curso de Excel',
      sellerIssuesInvoice: true,
    });
  });
  it('a refund and a chargeback name the order and carry no sale data', async () => {
    const refunded = await run(fixture('order-refunded'));
    expect(refunded).toMatchObject({
      operationKey: 'kiwify:9b1c2d3e-0000-4000-8000-000000000001',
      commercialState: 'refunded',
      refersTo: {
        ref: 'orderId',
        value: '9b1c2d3e-0000-4000-8000-000000000001',
      },
      customer: null,
      items: [],
    });
    const paid = await run(fixture('order-approved'));
    expect(paid.externalRefs.orderId).toBe(refunded.refersTo?.value);
    await expect(run(fixture('chargeback'))).resolves.toMatchObject({
      commercialState: 'disputed',
      refersTo: { ref: 'orderId' },
    });
  });
  it('a subscription renewal is a new sale with the subscription id on the side', async () => {
    const renewal = await run(fixture('subscription-order-approved'));
    expect(renewal.operationKey).toBe(
      'kiwify:9b1c2d3e-0000-4000-8000-000000000002',
    );
    expect(renewal.externalRefs.subscriptionId).toBe(
      '5f6e7d8c-0000-4000-8000-000000000001',
    );
  });
  it('keeps the real currency so the planner can block anything but BRL', async () => {
    const op = await run(
      edit('order-approved', (b) => (b.Commissions!.currency = 'usd')),
    );
    expect(op.currency).toBe('USD');
  });
  it('a foreign buyer or a missing document ends with no document (complete the data)', async () => {
    const foreign = await run(
      edit('order-approved', (b) => (b.Customer!.country = 'PT')),
    );
    expect(foreign.customer).toMatchObject({
      taxId: null,
      name: 'Maria da Silva',
    });
    const missing = await run(
      edit('order-approved', (b) => delete b.Customer!.CPF),
    );
    expect(missing.customer).toMatchObject({ taxId: null });
    const invalid = await run(
      edit('order-approved', (b) => (b.Customer!.CPF = '111.111.111-11')),
    );
    expect(invalid.customer).toMatchObject({ taxId: null });
    const none = await run(edit('order-approved', (b) => delete b.Customer));
    expect(none.customer).toBeNull();
  });
  it('a masked document is flagged, not used', async () => {
    const op = await run(
      edit('order-approved', (b) => (b.Customer!.CPF = '529.***.***-25')),
    );
    expect(op.customer).toMatchObject({ taxId: null, taxIdMasked: true });
  });
  it('"total" is the default and "mine" uses the producer share', async () => {
    const total = await run(fixture('order-approved'), {
      ...connection.credentials,
      invoiceValue: 'total',
    });
    expect(total.amountCents).toBe(10000);
    const mine = await run(fixture('order-approved'), {
      ...connection.credentials,
      invoiceValue: 'mine',
    });
    expect(mine.amountCents).toBe(8000);
  });
  it('"mine" without the producer share goes to attention instead of using the total', async () => {
    await expect(
      run(
        edit('order-approved', (b) => delete b.Commissions!.my_commission),
        { ...connection.credentials, invoiceValue: 'mine' },
      ),
    ).rejects.toThrow(ConnectorDataError);
  });
  it.each([[100.5], [0], [-1], [null], ['abc']])(
    'refuses a total that is not a positive integer of cents (%s)',
    async (amount) => {
      await expect(
        run(
          edit('order-approved', (b) => {
            b.Commissions!.charge_amount = amount;
            delete b.Commissions!.product_base_price;
          }),
        ),
      ).rejects.toThrow(ConnectorDataError);
    },
  );
  it('refuses an event that is not an order event', async () => {
    await expect(run(fixture('subscription-renewed'))).rejects.toThrow(
      ConnectorDataError,
    );
  });
});

describe('KiwifyConnector.validateConnection', () => {
  const connector = new KiwifyConnector();
  it('identifies the connection by its own public id, without calling Kiwify', async () => {
    const a = await connector.validateConnection(
      { token: 't', webhookSecret: 's' },
      'live',
      { publicId: 'pub_a' },
    );
    const b = await connector.validateConnection(
      { token: 't', webhookSecret: 's' },
      'live',
      { publicId: 'pub_b' },
    );
    expect(a.externalAccountId).toMatch(/^kiwify:[0-9a-f]{24}$/);
    expect(a.externalAccountId).not.toBe(b.externalAccountId);
  });
  it('refuses an empty token or an unknown value option', async () => {
    await expect(
      connector.validateConnection({ token: ' ' }, 'live', { publicId: 'p' }),
    ).rejects.toThrow(ConnectorDataError);
    await expect(
      connector.validateConnection(
        { token: 't', invoiceValue: 'half' },
        'live',
        {
          publicId: 'p',
        },
      ),
    ).rejects.toThrow(ConnectorDataError);
  });
  it('asks for the token and the generated URL secret, and offers the value choice as optional', () => {
    const fields = connector.manifest.credentialFields;
    expect(fields.find((f) => f.key === 'token')).toMatchObject({
      secret: true,
    });
    expect(fields.find((f) => f.key === 'webhookSecret')).toMatchObject({
      generate: true,
      inWebhookUrl: true,
    });
    expect(fields.find((f) => f.key === 'invoiceValue')).toMatchObject({
      optional: true,
      options: ['total', 'mine'],
    });
  });
});
