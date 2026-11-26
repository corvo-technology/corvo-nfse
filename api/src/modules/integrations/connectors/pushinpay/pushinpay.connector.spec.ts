import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PushinPayConnector } from './pushinpay.connector';
import {
  ConnectorDataError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'pushinpay:x',
  credentials: {
    webhookSecret: 'S3CRET-0123456789',
    webhookToken: 'TOKEN-0123456789',
  },
};
const req = (
  body: string,
  over: { secret?: string | null; token?: string | null } = {},
) => ({
  rawBody: Buffer.from(body),
  headers:
    over.token === null
      ? {}
      : { 'x-corvo-token': over.token ?? 'TOKEN-0123456789' },
  query:
    over.secret === null
      ? {}
      : { webhookSecret: over.secret ?? 'S3CRET-0123456789' },
});
const connector = new PushinPayConnector();
const normalize = (body: string) =>
  connector.normalize({
    connection,
    payload: body,
    delivery: {} as OperationDelivery,
  });

describe('PushinPayConnector.authenticate', () => {
  const body = fixture('pix-paid');

  it('accepts the right secret with the right header token', async () => {
    await expect(
      connector.authenticate(req(body), connection),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong or missing secret', async () => {
    await expect(
      connector.authenticate(req(body, { secret: 'wrong' }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
    await expect(
      connector.authenticate(req(body, { secret: null }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('rejects a wrong or missing header token when the connection has one', async () => {
    await expect(
      connector.authenticate(req(body, { token: 'wrong' }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_token' });
    await expect(
      connector.authenticate(req(body, { token: null }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_token' });
  });
  it('relies on the secret alone when the connection has no header token', async () => {
    const withoutToken = {
      ...connection,
      credentials: { webhookSecret: 'S3CRET-0123456789' },
    };
    await expect(
      connector.authenticate(req(body, { token: null }), withoutToken),
    ).resolves.toEqual({ ok: true });
  });
});

describe('PushinPayConnector.parse', () => {
  it('turns a paid Pix into an operation keyed by id and status', () => {
    expect(connector.parse(req(fixture('pix-paid')))).toEqual({
      kind: 'operation',
      deliveryId: '9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10:paid',
      externalType: 'paid',
    });
  });
  it('turns a cancellation into an operation with its own delivery id', () => {
    expect(connector.parse(req(fixture('pix-canceled')))).toEqual({
      kind: 'operation',
      deliveryId: '9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10:canceled',
      externalType: 'canceled',
    });
  });
  it('ignores a created charge', () => {
    expect(connector.parse(req(fixture('pix-created')))).toEqual({
      kind: 'ignored',
      externalType: 'created',
    });
  });
  it('treats a body without id or status as a test', () => {
    expect(connector.parse(req('{"hello":"world"}'))).toEqual({ kind: 'test' });
  });
});

describe('PushinPayConnector.normalize', () => {
  it('maps a paid Pix', async () => {
    const op = await normalize(fixture('pix-paid'));
    expect(op).toMatchObject({
      operationKey: 'pushinpay:9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10',
      commercialState: 'paid',
      amountCents: 2500,
      currency: 'BRL',
      description: null,
      customer: {
        name: 'Maria da Silva',
        email: null,
        taxId: '52998224725',
        taxIdMasked: false,
      },
      externalRefs: {
        transactionId: '9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10',
        endToEndId: 'E18236120202611251200s0a1b2c3d4e5',
      },
    });
    expect(op.paidAt).toBeInstanceOf(Date);
    expect(op.refersTo).toBeUndefined();
  });
  it('maps a paid boleto with a CNPJ', async () => {
    const op = await normalize(fixture('boleto-paid'));
    expect(op).toMatchObject({
      commercialState: 'paid',
      amountCents: 15000,
      customer: { taxId: '11222333000181' },
    });
  });
  it('keeps the subscription and installment of a recurring charge', async () => {
    const op = await normalize(fixture('recurring-installment-paid'));
    expect(op.externalRefs).toMatchObject({
      subscriptionId: 'sub-0001-aaaa',
      installmentNumber: '3',
    });
    expect(op.operationKey).toBe(
      'pushinpay:7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918',
    );
  });
  it('flags a masked document and drops an invalid one', async () => {
    const masked = await normalize(
      fixture('pix-paid').replace('52998224725', '529.***.***-25'),
    );
    expect(masked.customer).toMatchObject({ taxId: null, taxIdMasked: true });
    const formatted = await normalize(
      fixture('pix-paid').replace('52998224725', '529.982.247-25'),
    );
    expect(formatted.customer?.taxId).toBe('52998224725');
  });
  it('a cancellation refers to the paid sale by transaction id', async () => {
    const op = await normalize(fixture('pix-canceled'));
    expect(op).toMatchObject({
      commercialState: 'refunded',
      refersTo: {
        ref: 'transactionId',
        value: '9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10',
      },
      amountCents: 2500,
    });
  });
  it('rejects a body with a bad amount or no id', async () => {
    await expect(
      normalize(fixture('pix-paid').replace('2500', '"25.00"')),
    ).rejects.toBeInstanceOf(ConnectorDataError);
    await expect(
      normalize('{"status":"paid","value":100}'),
    ).rejects.toBeInstanceOf(ConnectorDataError);
  });
});

describe('PushinPayConnector.validateConnection', () => {
  it('derives the account id from the connection secret without any call', async () => {
    const a = await connector.validateConnection(
      { webhookSecret: 'one' },
      'live',
      { publicId: 'p' },
    );
    const b = await connector.validateConnection(
      { webhookSecret: 'two' },
      'live',
      { publicId: 'p' },
    );
    expect(a.externalAccountId).toMatch(/^pushinpay:[0-9a-f]{24}$/);
    expect(a.externalAccountId).not.toBe(b.externalAccountId);
  });
});
