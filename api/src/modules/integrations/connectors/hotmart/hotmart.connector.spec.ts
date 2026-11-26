/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HotmartConnector } from './hotmart.connector';
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
const HOTTOK = 'hottok-fake-for-tests-0123456789';
const URL_SECRET = 'S3CRET-0123456789';
const connection = (invoiceValue?: string): ConnectionView => ({
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'hotmart:abc',
  credentials: {
    hottok: HOTTOK,
    webhookSecret: URL_SECRET,
    ...(invoiceValue ? { invoiceValue } : {}),
  },
});
const req = (
  body: string,
  over: { secret?: string | null; hottok?: string | null } = {},
) => ({
  rawBody: Buffer.from(body),
  headers:
    over.hottok === null ? {} : { 'x-hotmart-hottok': over.hottok ?? HOTTOK },
  query:
    over.secret === null ? {} : { webhookSecret: over.secret ?? URL_SECRET },
});

const connector = new HotmartConnector();
const normalize = (body: string, conn = connection()) => {
  const delivery = connector.parse(req(body)) as OperationDelivery;
  return connector.normalize({ connection: conn, payload: body, delivery });
};

describe('HotmartConnector.authenticate', () => {
  const body = fixture('purchase-approved');
  const auth = (r: ReturnType<typeof req>) =>
    connector.authenticate(r, connection());

  it('accepts the right hottok with the right URL secret', async () => {
    await expect(auth(req(body))).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing URL secret even with the right hottok', async () => {
    await expect(auth(req(body, { secret: 'wrong' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
    await expect(auth(req(body, { secret: null }))).resolves.toEqual({
      ok: false,
      reason: 'bad_secret',
    });
  });
  it('rejects a missing or wrong hottok even with the right URL secret', async () => {
    await expect(auth(req(body, { hottok: null }))).resolves.toEqual({
      ok: false,
      reason: 'missing_hottok',
    });
    await expect(auth(req(body, { hottok: 'nope' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_hottok',
    });
  });
  it('rejects when the connection has no hottok stored', async () => {
    const conn = connection();
    delete conn.credentials.hottok;
    await expect(connector.authenticate(req(body), conn)).resolves.toEqual({
      ok: false,
      reason: 'bad_hottok',
    });
  });
});

describe('HotmartConnector.parse', () => {
  it('turns an approved purchase into an operation', () => {
    expect(connector.parse(req(fixture('purchase-approved')))).toEqual({
      kind: 'operation',
      deliveryId: 'HP00000000000001:PURCHASE_APPROVED',
      externalType: 'PURCHASE_APPROVED',
    });
  });
  it.each([
    'PURCHASE_CANCELED',
    'PURCHASE_EXPIRED',
    'PURCHASE_DELAYED',
    'PURCHASE_BILLET_PRINTED',
    'SUBSCRIPTION_CANCELLATION',
  ])('ignores %s with a 2xx-able result', (event) => {
    const body = edit('purchase-approved', (e) => (e.event = event));
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: event,
    });
  });
  it('ignores an affiliate notice, which has no price', () => {
    const body = edit('purchase-approved', (e) => {
      delete e.data.buyer;
      delete e.data.purchase.full_price;
    });
    expect(connector.parse(req(body)).kind).toBe('ignored');
  });
  it('ignores a partial refund', () => {
    const body = edit('purchase-refunded', (e) => {
      e.data.purchase.status = 'PARTIALLY_REFUNDED';
    });
    expect(connector.parse(req(body)).kind).toBe('ignored');
  });
  it('treats a body with no event as a test', () => {
    expect(connector.parse(req('{}'))).toEqual({ kind: 'test' });
  });
  it('keeps one id per transaction and event', () => {
    const complete = edit(
      'purchase-approved',
      (e) => (e.event = 'PURCHASE_COMPLETE'),
    );
    expect(connector.parse(req(complete))).toMatchObject({
      deliveryId: 'HP00000000000001:PURCHASE_COMPLETE',
    });
  });
  it('rejects an event that names no transaction', () => {
    const body = edit('purchase-approved', (e) => {
      delete e.data.purchase.transaction;
    });
    expect(() => connector.parse(req(body))).toThrow(ConnectorDataError);
  });
});

describe('HotmartConnector.normalize', () => {
  it('normalizes an approved sale by the seller in Brazil as paid', async () => {
    const op = await normalize(fixture('purchase-approved'));
    expect(op).toMatchObject({
      operationKey: 'hotmart:HP00000000000001',
      commercialState: 'paid',
      currency: 'BRL',
      amountCents: 9790,
      sellerIssuesInvoice: true,
      description: 'Curso de Exemplo',
      externalRefs: { transaction: 'HP00000000000001' },
      customer: {
        name: 'Maria Compradora',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
      },
      items: [
        {
          externalProductId: '4000001',
          description: 'Curso de Exemplo',
          quantity: 1,
        },
      ],
    });
    expect(op.occurredAt).toEqual(new Date(1793285900000));
    expect(op.paidAt).toEqual(new Date(1793285900000));
    expect(op.refersTo).toBeUndefined();
  });
  it('uses creation_date when there is no approved_date', async () => {
    const body = edit('purchase-approved', (e) => {
      delete e.data.purchase.approved_date;
    });
    expect((await normalize(body)).occurredAt).toEqual(new Date(1793286000000));
  });
  it('gives the same operation to COMPLETE as to APPROVED, so no second invoice', async () => {
    const approved = await normalize(fixture('purchase-approved'));
    const complete = await normalize(
      edit('purchase-approved', (e) => (e.event = 'PURCHASE_COMPLETE')),
    );
    expect(complete.operationKey).toBe(approved.operationKey);
    expect(complete.commercialState).toBe('paid');
  });
  it('marks a sale the Hotmart invoices as not ours to issue', async () => {
    const byHotmart = edit('purchase-approved', (e) => {
      e.data.purchase.invoice_by = 'HOTMART';
    });
    expect((await normalize(byHotmart)).sellerIssuesInvoice).toBe(false);
    const model = edit('purchase-approved', (e) => {
      e.data.purchase.business_model = 'R';
    });
    expect((await normalize(model)).sellerIssuesInvoice).toBe(false);
    const missing = edit('purchase-approved', (e) => {
      delete e.data.purchase.invoice_by;
    });
    expect((await normalize(missing)).sellerIssuesInvoice).toBe(false);
  });
  it('sends a foreign buyer to complete the data, never an automatic invoice', async () => {
    const country = edit('purchase-approved', (e) => {
      e.data.buyer.address.country_iso = 'PT';
    });
    expect((await normalize(country)).customer?.taxId).toBeNull();
    const type = edit('purchase-approved', (e) => {
      e.data.buyer.document = 'X1234567';
      e.data.buyer.document_type = 'PASSPORT';
    });
    expect((await normalize(type)).customer?.taxId).toBeNull();
  });
  it('has no tax id when the checkout did not ask for the buyer data', async () => {
    const noBuyer = edit('purchase-approved', (e) => delete e.data.buyer);
    expect((await normalize(noBuyer)).customer).toBeNull();
  });
  it('keeps a non-BRL currency so the planner blocks it', async () => {
    const usd = edit('purchase-approved', (e) => {
      e.data.purchase.full_price.currency_value = 'USD';
    });
    expect((await normalize(usd)).currency).toBe('USD');
  });
  it('rounds reais to cents without float drift', async () => {
    const body = edit('purchase-approved', (e) => {
      e.data.purchase.full_price.value = 19.99;
    });
    expect((await normalize(body)).amountCents).toBe(1999);
  });

  describe('option "minha parte"', () => {
    const share = connection('mine');
    it('takes out coproducer and affiliate, keeps the producer', async () => {
      const op = await normalize(fixture('purchase-approved'), share);
      // 97.90 - 10.00 - 15.50
      expect(op.amountCents).toBe(7240);
    });
    it('is the total with "total" or no setting at all', async () => {
      const total = await normalize(
        fixture('purchase-approved'),
        connection('total'),
      );
      expect(total.amountCents).toBe(9790);
    });
    it('accepts commissions as an object too', async () => {
      const body = edit('purchase-approved', (e) => {
        e.data.commissions = {
          value: 15.5,
          currency_value: 'BRL',
          source: 'AFFILIATE',
        };
      });
      expect((await normalize(body, share)).amountCents).toBe(8240);
    });
    it('goes to attention when commissions are missing or unreadable', async () => {
      const none = edit('purchase-approved', (e) => delete e.data.commissions);
      await expect(normalize(none, share)).rejects.toThrow(ConnectorDataError);
      const other = edit('purchase-approved', (e) => {
        e.data.commissions[1].currency_value = 'USD';
      });
      await expect(normalize(other, share)).rejects.toThrow(ConnectorDataError);
    });
    it('goes to attention when nothing is left', async () => {
      const body = edit('purchase-approved', (e) => {
        e.data.commissions[1].value = 100;
      });
      await expect(normalize(body, share)).rejects.toThrow(ConnectorDataError);
    });
  });

  describe('refunds and disputes', () => {
    it('links a refund to the sale by transaction', async () => {
      const op = await normalize(fixture('purchase-refunded'));
      expect(op).toMatchObject({
        operationKey: 'hotmart:HP00000000000001',
        commercialState: 'refunded',
        refersTo: { ref: 'transaction', value: 'HP00000000000001' },
        paidAt: null,
      });
      expect(op.occurredAt).toEqual(new Date(1793372400000));
    });
    it('treats a chargeback as a refund of that sale', async () => {
      const body = edit('purchase-refunded', (e) => {
        e.event = 'PURCHASE_CHARGEBACK';
        e.data.purchase.status = 'CHARGEBACK';
      });
      expect(connector.parse(req(body))).toMatchObject({
        kind: 'operation',
        deliveryId: 'HP00000000000001:PURCHASE_CHARGEBACK',
      });
      expect(await normalize(body)).toMatchObject({
        commercialState: 'refunded',
        refersTo: { ref: 'transaction', value: 'HP00000000000001' },
      });
    });
    it('only flags a protest as disputed (no cancellation)', async () => {
      const body = edit('purchase-refunded', (e) => {
        e.event = 'PURCHASE_PROTEST';
        e.data.purchase.status = 'PROTEST';
      });
      expect(await normalize(body)).toMatchObject({
        commercialState: 'disputed',
        refersTo: { ref: 'transaction', value: 'HP00000000000001' },
      });
    });
  });
});

describe('HotmartConnector manifest and connection', () => {
  it('asks for the hottok, generates the URL secret and offers the value option', () => {
    const fields = connector.manifest.credentialFields;
    expect(fields.find((f) => f.key === 'hottok')).toMatchObject({
      secret: true,
    });
    expect(fields.find((f) => f.key === 'webhookSecret')).toMatchObject({
      generate: true,
      inWebhookUrl: true,
    });
    const option = fields.find((f) => f.key === 'invoiceValue');
    expect(option?.secret).toBe(false);
    expect(option?.options).toEqual(['total', 'mine']);
  });
  it('names the account from the URL secret, so a new hottok keeps the same id', async () => {
    const a = await connector.validateConnection(
      { hottok: 'one', webhookSecret: URL_SECRET },
      'live',
      { publicId: 'p' },
    );
    const b = await connector.validateConnection(
      { hottok: 'two', webhookSecret: URL_SECRET },
      'live',
      { publicId: 'p' },
    );
    expect(a.externalAccountId).toMatch(/^hotmart:[0-9a-f]{24}$/);
    expect(b).toEqual(a);
  });
});
