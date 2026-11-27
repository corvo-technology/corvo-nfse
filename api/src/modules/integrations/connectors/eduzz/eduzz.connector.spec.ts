/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EduzzConnector } from './eduzz.connector';
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
const KEY = 'eduzz-key-fake-for-tests-0123456789';
const URL_SECRET = 'S3CRET-0123456789';
const sign = (body: string, key = KEY, encoding: 'hex' | 'base64' = 'hex') =>
  createHmac('sha256', key).update(body).digest(encoding);
const connection = (invoiceValue?: string): ConnectionView => ({
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'eduzz:abc',
  credentials: {
    secretKey: KEY,
    webhookSecret: URL_SECRET,
    ...(invoiceValue ? { invoiceValue } : {}),
  },
});
const req = (
  body: string,
  over: { secret?: string | null; signature?: string | null } = {},
) => ({
  rawBody: Buffer.from(body),
  headers:
    over.signature === null
      ? {}
      : { 'x-signature': over.signature ?? sign(body) },
  query:
    over.secret === null ? {} : { webhookSecret: over.secret ?? URL_SECRET },
});

const connector = new EduzzConnector();
const normalize = (body: string, conn = connection()) => {
  const delivery = connector.parse(req(body)) as OperationDelivery;
  return connector.normalize({ connection: conn, payload: body, delivery });
};

describe('EduzzConnector.authenticate', () => {
  const body = fixture('invoice-paid');
  const auth = (r: ReturnType<typeof req>, conn = connection()) =>
    connector.authenticate(r, conn);

  it('accepts the right signature (hex or base64) with the right URL secret', async () => {
    await expect(auth(req(body))).resolves.toEqual({ ok: true });
    await expect(
      auth(req(body, { signature: sign(body, KEY, 'base64') })),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing URL secret even with a good signature', async () => {
    await expect(auth(req(body, { secret: 'wrong' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
    await expect(auth(req(body, { secret: null }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
  });
  it('rejects a missing, wrong or other-key signature', async () => {
    await expect(auth(req(body, { signature: null }))).resolves.toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    await expect(auth(req(body, { signature: 'nope' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    await expect(
      auth(req(body, { signature: sign(body, 'other-key') })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a signature made for another body', async () => {
    await expect(
      auth(req(body, { signature: sign('{"x":1}') })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects when the connection has no key stored', async () => {
    const conn = connection();
    delete conn.credentials.secretKey;
    await expect(auth(req(body), conn)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('EduzzConnector.parse', () => {
  it('turns a paid invoice into an operation', () => {
    expect(connector.parse(req(fixture('invoice-paid')))).toEqual({
      kind: 'operation',
      deliveryId: '12345678:myeduzz.invoice_paid',
      externalType: 'myeduzz.invoice_paid',
    });
  });
  it.each([
    'myeduzz.invoice_opened',
    'myeduzz.invoice_expired',
    'myeduzz.invoice_waiting_payment',
    'nutror.lesson_started',
  ])('ignores %s with a 2xx-able result', (event) => {
    const body = edit('invoice-paid', (e) => (e.event = event));
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: event,
    });
  });
  it('ignores a partial refund', () => {
    const body = edit('invoice-refunded', (e) => {
      e.data.refund.type = 'partial';
    });
    expect(connector.parse(req(body)).kind).toBe('ignored');
  });
  it('treats a body with no event as a test', () => {
    expect(connector.parse(req('{}'))).toEqual({ kind: 'test' });
  });
  it('accepts a numeric invoice id', () => {
    const body = edit('invoice-paid', (e) => (e.data.id = 777));
    expect(connector.parse(req(body))).toMatchObject({
      deliveryId: '777:myeduzz.invoice_paid',
    });
  });
  it('rejects an event that names no invoice', () => {
    const body = edit('invoice-paid', (e) => delete e.data.id);
    expect(() => connector.parse(req(body))).toThrow(ConnectorDataError);
  });
});

describe('EduzzConnector.normalize', () => {
  it('normalizes a paid invoice with the buyer, address and products', async () => {
    const op = await normalize(fixture('invoice-paid'));
    expect(op).toMatchObject({
      operationKey: 'eduzz:12345678',
      commercialState: 'paid',
      currency: 'BRL',
      amountCents: 30150,
      sellerIssuesInvoice: true,
      description: 'Widget X, Gadget Y',
      externalRefs: { invoice: '12345678', transaction: '123456' },
      customer: {
        name: 'Alice Johnson',
        email: 'alice.johnson@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
        address: {
          street: 'Rua avenida, 123',
          city: 'Cidade',
          zip: '12345123',
          country: 'BR',
        },
      },
      items: [
        { externalProductId: 'P567', description: 'Widget X', quantity: 1 },
        { externalProductId: 'P789', description: 'Gadget Y', quantity: 1 },
      ],
    });
    // "Estado" is not a UF
    expect(op.customer?.address).not.toHaveProperty('state');
    expect(op.occurredAt).toEqual(new Date('2024-01-10T17:45:00.000Z'));
    expect(op.paidAt).toEqual(new Date('2024-01-10T17:45:00.000Z'));
    expect(op.refersTo).toBeUndefined();
  });
  it('keeps a real UF', async () => {
    const body = edit(
      'invoice-paid',
      (e) => (e.data.buyer.address.state = 'sp'),
    );
    expect((await normalize(body)).customer?.address?.state).toBe('SP');
  });
  it('falls back to price when paid is missing, and to createdAt without paidAt', async () => {
    const body = edit('invoice-paid', (e) => {
      delete e.data.paid;
      delete e.data.paidAt;
      e.data.price.value = 19.99;
    });
    const op = await normalize(body);
    expect(op.amountCents).toBe(1999);
    expect(op.occurredAt).toEqual(new Date('2024-01-09T14:45:00.000Z'));
  });
  it('sends a foreign buyer to complete the data, never an automatic invoice', async () => {
    const body = edit('invoice-paid', (e) => {
      e.data.buyer.address.country = 'Portugal';
    });
    const op = await normalize(body);
    expect(op.customer?.taxId).toBeNull();
    expect(op.customer?.address).toBeUndefined();
  });
  it('has no customer when the buyer is missing', async () => {
    const body = edit('invoice-paid', (e) => delete e.data.buyer);
    expect((await normalize(body)).customer).toBeNull();
  });
  it('keeps a non-BRL currency so the planner blocks it', async () => {
    const body = edit('invoice-paid', (e) => (e.data.paid.currency = 'USD'));
    expect((await normalize(body)).currency).toBe('USD');
  });
  it('goes to attention when the amount is not positive', async () => {
    const body = edit('invoice-paid', (e) => {
      e.data.paid.value = 0;
    });
    await expect(normalize(body)).rejects.toThrow(ConnectorDataError);
  });

  describe('option "minha parte"', () => {
    const share = connection('mine');
    it('uses what the producer earns', async () => {
      expect(
        (await normalize(fixture('invoice-paid'), share)).amountCents,
      ).toBe(22000);
    });
    it('is the total with "total" or no setting at all', async () => {
      const total = await normalize(
        fixture('invoice-paid'),
        connection('total'),
      );
      expect(total.amountCents).toBe(30150);
    });
    it('goes to attention when the producer share is missing, other currency or zero', async () => {
      const none = edit('invoice-paid', (e) => delete e.data.gains);
      await expect(normalize(none, share)).rejects.toThrow(ConnectorDataError);
      const other = edit('invoice-paid', (e) => {
        e.data.gains.producer.currency = 'USD';
      });
      await expect(normalize(other, share)).rejects.toThrow(ConnectorDataError);
      const zero = edit('invoice-paid', (e) => {
        e.data.gains.producer.value = 0;
      });
      await expect(normalize(zero, share)).rejects.toThrow(ConnectorDataError);
    });
  });

  describe('refunds, chargebacks and cancellations', () => {
    it('links a refund to the sale by invoice', async () => {
      const op = await normalize(fixture('invoice-refunded'));
      expect(op).toMatchObject({
        operationKey: 'eduzz:12345678',
        commercialState: 'refunded',
        refersTo: { ref: 'invoice', value: '12345678' },
        paidAt: null,
        customer: null,
      });
      expect(op.occurredAt).toEqual(new Date('2024-01-31T15:00:00.000Z'));
    });
    it('treats a chargeback as a refund of that sale', async () => {
      expect(connector.parse(req(fixture('invoice-chargeback')))).toMatchObject(
        {
          kind: 'operation',
          deliveryId: '12345678:myeduzz.invoice_chargeback',
        },
      );
      expect(await normalize(fixture('invoice-chargeback'))).toMatchObject({
        commercialState: 'refunded',
        refersTo: { ref: 'invoice', value: '12345678' },
      });
    });
    it('treats a cancellation as a refund of that sale', async () => {
      const body = edit('invoice-refunded', (e) => {
        e.event = 'myeduzz.invoice_canceled';
        e.data.status = 'canceled';
        delete e.data.refund;
        delete e.data.refundedAt;
      });
      const op = await normalize(body);
      expect(op).toMatchObject({
        commercialState: 'refunded',
        refersTo: { ref: 'invoice', value: '12345678' },
      });
      expect(op.occurredAt).toEqual(new Date('2024-01-20T15:00:00.000Z'));
    });
  });
});

describe('EduzzConnector manifest and connection', () => {
  it('asks for the secret key, generates the URL secret and offers the value option', () => {
    const fields = connector.manifest.credentialFields;
    expect(fields.find((f) => f.key === 'secretKey')).toMatchObject({
      secret: true,
    });
    expect(fields.find((f) => f.key === 'webhookSecret')).toMatchObject({
      generate: true,
      inWebhookUrl: true,
    });
    const option = fields.find((f) => f.key === 'invoiceValue');
    expect(option?.secret).toBe(false);
    expect(option?.options).toEqual(['total', 'mine']);
    expect(connector.manifest.webhookEvents).toContain('myeduzz.invoice_paid');
  });
  it('names the account from the URL secret, so a new key keeps the same id', async () => {
    const a = await connector.validateConnection(
      { secretKey: 'one', webhookSecret: URL_SECRET },
      'live',
      { publicId: 'p' },
    );
    const b = await connector.validateConnection(
      { secretKey: 'two', webhookSecret: URL_SECRET },
      'live',
      { publicId: 'p' },
    );
    expect(a.externalAccountId).toMatch(/^eduzz:[0-9a-f]{24}$/);
    expect(b).toEqual(a);
  });
});
