/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PagarmeConnector } from './pagarme.connector';
import {
  ConnectorDataError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

type Json = Record<string, any>;

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const edit = (name: string, change: (event: Json) => void) => {
  const event = JSON.parse(fixture(name)) as Json;
  change(event);
  return JSON.stringify(event);
};
const URL_SECRET = 'S3CRET-0123456789';
const USER = 'user-fake-0123';
const PASSWORD = 'pass-fake-0123';
const SECRET_KEY = 'sk_test_fake_for_tests_0123456789';
const basic = (user = USER, password = PASSWORD) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const connection = (extra: Record<string, string> = {}): ConnectionView => ({
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'pagarme:abc',
  credentials: {
    webhookSecret: URL_SECRET,
    webhookUser: USER,
    webhookPassword: PASSWORD,
    ...extra,
  },
});
const req = (
  body: string,
  over: {
    secret?: string | null;
    headers?: Record<string, string>;
  } = {},
) => ({
  rawBody: Buffer.from(body),
  headers: over.headers ?? {},
  query:
    over.secret === null ? {} : { webhookSecret: over.secret ?? URL_SECRET },
});

const connector = new PagarmeConnector();
const normalize = (body: string) => {
  const delivery = connector.parse(req(body)) as OperationDelivery;
  return connector.normalize({
    connection: connection(),
    payload: body,
    delivery,
  });
};

describe('PagarmeConnector.authenticate', () => {
  const body = fixture('order-paid');
  const auth = (r: ReturnType<typeof req>, conn = connection()) =>
    connector.authenticate(r, conn);

  it('accepts the URL secret, with or without correct Basic credentials', async () => {
    await expect(auth(req(body))).resolves.toEqual({ ok: true });
    await expect(
      auth(req(body, { headers: { authorization: basic() } })),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing URL secret', async () => {
    for (const secret of ['wrong', null])
      await expect(auth(req(body, { secret }))).resolves.toEqual({
        ok: false,
        reason: 'bad_secret',
      });
  });
  it('rejects when the connection has no URL secret stored', async () => {
    const conn = connection();
    delete conn.credentials.webhookSecret;
    await expect(auth(req(body), conn)).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
  });
  it('rejects wrong Basic credentials, even with the right URL secret', async () => {
    await expect(
      auth(req(body, { headers: { authorization: basic(USER, 'nope') } })),
    ).resolves.toEqual({ ok: false, reason: 'bad_basic_auth' });
    await expect(
      auth(req(body, { headers: { authorization: 'Bearer abc' } })),
    ).resolves.toEqual({ ok: false, reason: 'bad_basic_auth' });
  });
  describe('with the secret key given', () => {
    const conn = () => connection({ secretKey: SECRET_KEY });
    const signature = (raw: string, key = SECRET_KEY) =>
      `sha1=${createHmac('sha1', key).update(raw).digest('hex')}`;
    it('accepts a right X-Hub-Signature', async () => {
      await expect(
        auth(
          req(body, { headers: { 'x-hub-signature': signature(body) } }),
          conn(),
        ),
      ).resolves.toEqual({ ok: true });
    });
    it('rejects a missing, wrong or other-body signature', async () => {
      await expect(auth(req(body), conn())).resolves.toEqual({
        ok: false,
        reason: 'missing_signature',
      });
      for (const value of [
        signature(body, 'other-key'),
        signature(body + ' '),
        'sha1=',
      ])
        await expect(
          auth(req(body, { headers: { 'x-hub-signature': value } }), conn()),
        ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    });
  });
});

describe('PagarmeConnector.parse', () => {
  it('turns a paid order into an operation keyed by the order id', () => {
    expect(connector.parse(req(fixture('order-paid')))).toEqual({
      kind: 'operation',
      deliveryId: 'or_ZdnB5BBCmYhk534R:order.paid',
      externalType: 'order.paid',
    });
  });
  it('keys refunds and chargebacks by charge, a cancelled order by order', () => {
    expect(connector.parse(req(fixture('charge-refunded')))).toMatchObject({
      deliveryId: 'ch_d22356Jf4WuGr8no:charge.refunded',
    });
    expect(connector.parse(req(fixture('charge-chargedback')))).toMatchObject({
      deliveryId: 'ch_w3oN9YVsJbfr7NM1:charge.chargedback',
    });
    expect(connector.parse(req(fixture('order-canceled')))).toMatchObject({
      deliveryId: 'or_Wm4sXk2LbQe9RtYa:order.canceled',
    });
  });
  it.each([
    'order.created',
    'charge.paid',
    'charge.partial_canceled',
    'order.payment_failed',
  ])('ignores %s', (type) => {
    const body = edit('order-paid', (e) => (e.type = type));
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: type,
    });
  });
  it('ignores an order.paid that is not paid', () => {
    const body = edit('order-paid', (e) => (e.data.status = 'pending'));
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: 'order.paid',
    });
  });
  it('treats a body without a type as a test', () => {
    expect(connector.parse(req('{}'))).toEqual({ kind: 'test' });
  });
  it('reads the charge of a chargeback.received in its known shapes', () => {
    for (const data of [
      { charge: { id: 'ch_1' } },
      { charge_id: 'ch_1' },
      { id: 'ch_1' },
    ])
      expect(
        connector.parse(
          req(JSON.stringify({ type: 'chargeback.received', data })),
        ),
      ).toMatchObject({ deliveryId: 'ch_1:chargeback.received' });
  });
  it('refuses an event without an id', () => {
    expect(() =>
      connector.parse(
        req(JSON.stringify({ type: 'chargeback.received', data: { id: 'x' } })),
      ),
    ).toThrow(ConnectorDataError);
    expect(() =>
      connector.parse(req(edit('order-paid', (e) => delete e.data.id))),
    ).toThrow(ConnectorDataError);
  });
});

describe('PagarmeConnector.normalize', () => {
  it('maps the documented order.paid example', async () => {
    const op = await normalize(fixture('order-paid'));
    expect(op).toMatchObject({
      operationKey: 'pagarme:or_ZdnB5BBCmYhk534R',
      commercialState: 'paid',
      externalRefs: {
        orderId: 'or_ZdnB5BBCmYhk534R',
        chargeId: 'ch_d22356Jf4WuGr8no',
        orderCode: '1303724',
      },
      currency: 'BRL',
      amountCents: 12356,
      discountCents: 0,
      description: 'Produto',
      items: [{ externalProductId: null, description: 'Produto', quantity: 1 }],
      customer: {
        name: 'FABIO',
        email: 'abc@teste.com',
        taxId: '09006068709',
        taxIdMasked: false,
      },
      sellerIssuesInvoice: true,
    });
    expect(op.paidAt).toEqual(new Date('2022-06-29T20:23:47Z'));
    // The only address in the example is the shipping one, as a fallback.
    expect(op.customer?.address).toMatchObject({
      street: '10880, Malibu Point, Malibu Central',
      zip: '90265',
    });
  });

  it('maps a company buyer with its address and quantity', async () => {
    const op = await normalize(fixture('order-paid-cnpj'));
    expect(op.amountCents).toBe(25000);
    expect(op.items).toEqual([
      {
        externalProductId: null,
        description: 'Consultoria mensal',
        quantity: 2,
      },
    ]);
    expect(op.customer).toEqual({
      name: 'Empresa Exemplo Ltda',
      email: 'financeiro@exemplo.com.br',
      taxId: '11222333000181',
      taxIdMasked: false,
      address: {
        street: 'Rua Exemplo, 100, Sala 2',
        city: 'São Paulo',
        state: 'SP',
        zip: '01310100',
        country: 'BR',
      },
    });
    expect(op.paidAt).toEqual(new Date('2026-11-20T14:05:09Z'));
  });

  it('drops the tax ID of a buyer whose document is not CPF or CNPJ', async () => {
    const op = await normalize(
      edit(
        'order-paid-cnpj',
        (e) => (e.data.customer.document_type = 'PASSPORT'),
      ),
    );
    expect(op.customer?.taxId).toBeNull();
  });

  it('keeps a missing buyer e-mail as null', async () => {
    const op = await normalize(
      edit('order-paid-cnpj', (e) => delete e.data.customer.email),
    );
    expect(op.customer?.email).toBeNull();
  });

  it('refuses an amount that is not positive whole cents', async () => {
    for (const amount of [0, -5, 10.5, '100', null])
      await expect(
        normalize(edit('order-paid', (e) => (e.data.amount = amount))),
      ).rejects.toThrow(ConnectorDataError);
  });

  it('ties a refund to the sale by charge id', async () => {
    const op = await normalize(fixture('charge-refunded'));
    expect(op).toMatchObject({
      commercialState: 'refunded',
      refersTo: { ref: 'chargeId', value: 'ch_d22356Jf4WuGr8no' },
      customer: null,
    });
  });
  it('ties a cancelled order to the sale by order id, as a refund', async () => {
    expect(await normalize(fixture('order-canceled'))).toMatchObject({
      commercialState: 'refunded',
      refersTo: { ref: 'orderId', value: 'or_Wm4sXk2LbQe9RtYa' },
    });
  });
  it('flags a chargeback as disputed, tied by charge id', async () => {
    expect(await normalize(fixture('charge-chargedback'))).toMatchObject({
      commercialState: 'disputed',
      refersTo: { ref: 'chargeId', value: 'ch_w3oN9YVsJbfr7NM1' },
    });
  });
  it('rejects an event that is not a sale event', async () => {
    await expect(
      normalize(edit('order-paid', (e) => (e.type = 'order.created'))),
    ).rejects.toThrow(ConnectorDataError);
  });
});

describe('PagarmeConnector.validateConnection', () => {
  it('derives a stable account id from the connection secret', async () => {
    const a = await connector.validateConnection(
      { webhookSecret: 'a' },
      'live',
      { publicId: 'p' },
    );
    const again = await connector.validateConnection(
      { webhookSecret: 'a' },
      'live',
      { publicId: 'p' },
    );
    const b = await connector.validateConnection(
      { webhookSecret: 'b' },
      'live',
      { publicId: 'p' },
    );
    expect(a).toEqual(again);
    expect(a.externalAccountId).not.toBe(b.externalAccountId);
    expect(a.externalAccountId).toMatch(/^pagarme:[0-9a-f]{24}$/);
  });
});
