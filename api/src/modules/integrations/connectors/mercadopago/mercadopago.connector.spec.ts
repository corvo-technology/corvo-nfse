import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MercadoPagoConnector } from './mercadopago.connector';
import type { MercadoPagoClient } from './mercadopago.client';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const payment = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name)) as Record<string, unknown>;

const SIGNING = 'mp_fake_signing_secret_for_tests';
const URL_SECRET = 'S3CRET-0123456789';
const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'live',
  externalAccountId: '44444',
  credentials: {
    webhookSecret: URL_SECRET,
    webhookSigningSecret: SIGNING,
    accessToken: 'APP_USR-fake-token',
  },
};
const sign = (manifest: string, key = SIGNING) =>
  createHmac('sha256', key).update(manifest).digest('hex');

const req = (
  body: string,
  over: {
    secret?: string | null;
    header?: string | null;
    dataId?: string | null;
    requestId?: string | null;
    ts?: string;
    key?: string;
  } = {},
) => {
  const dataId = over.dataId === undefined ? '999999999' : over.dataId;
  const requestId = over.requestId === undefined ? 'req-1' : over.requestId;
  const ts = over.ts ?? '1793286000';
  const manifest =
    (dataId ? `id:${dataId.toLowerCase()};` : '') +
    (requestId ? `request-id:${requestId};` : '') +
    `ts:${ts};`;
  const header =
    over.header === undefined
      ? `ts=${ts},v1=${sign(manifest, over.key)}`
      : over.header;
  const headers: Record<string, string> = {};
  if (header !== null) headers['x-signature'] = header;
  if (requestId) headers['x-request-id'] = requestId;
  const query: Record<string, string> = {};
  if (over.secret !== null) query.webhookSecret = over.secret ?? URL_SECRET;
  if (dataId) query['data.id'] = dataId;
  return { rawBody: Buffer.from(body), headers, query };
};

describe('MercadoPagoConnector.authenticate', () => {
  const body = fixture('notification-payment-created');
  const connector = new MercadoPagoConnector();
  const auth = (r: ReturnType<typeof req>) =>
    connector.authenticate(r, connection);

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
  it('rejects a missing signature header and a tampered signature', async () => {
    await expect(auth(req(body, { header: null }))).resolves.toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    await expect(
      auth(req(body, { header: `ts=1793286000,v1=${'0'.repeat(64)}` })),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a signature made with another secret', async () => {
    await expect(auth(req(body, { key: 'other' }))).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('rejects when the payment id or request id differ from what was signed', async () => {
    const good = req(body);
    await expect(
      auth({ ...good, query: { ...good.query, 'data.id': '1' } }),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    await expect(
      auth({ ...good, headers: { ...good.headers, 'x-request-id': 'other' } }),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a header without ts or v1', async () => {
    for (const header of ['v1=abc', 'ts=1', 'nonsense'])
      await expect(auth(req(body, { header }))).resolves.toEqual({
        ok: false,
        reason: 'bad_signature',
      });
  });
  it('takes the payment id from the body when the URL has none', async () => {
    const request = req(body);
    delete request.query['data.id'];
    await expect(auth(request)).resolves.toEqual({ ok: true });
  });
  it('lowercases an alphanumeric id and leaves out absent parts of the manifest', async () => {
    await expect(
      auth(req(body, { dataId: 'ABC123', requestId: null })),
    ).resolves.toEqual({ ok: true });
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
    expect(JSON.stringify(result)).not.toContain(SIGNING);
  });
});

describe('MercadoPagoConnector.parse', () => {
  const connector = new MercadoPagoConnector();
  const parse = (body: string) => connector.parse(req(body));

  it('a payment notice is an operation with the environment and account', () => {
    expect(parse(fixture('notification-payment-created'))).toEqual({
      kind: 'operation',
      deliveryId: '999999999:payment.created:2026-11-20T10:04:58.396-03:00',
      externalType: 'payment.created',
      environment: 'live',
      externalAccountId: '44444',
    });
    expect(
      parse(
        JSON.stringify({
          ...JSON.parse(fixture('notification-payment-updated')),
          live_mode: false,
        }),
      ),
    ).toMatchObject({ environment: 'test' });
  });
  it('two updates of one payment are two deliveries; a redelivery is the same one', () => {
    const created = parse(fixture('notification-payment-created'));
    const updated = parse(fixture('notification-payment-updated'));
    expect(created).not.toEqual(updated);
    expect(parse(fixture('notification-payment-updated'))).toEqual(updated);
  });
  it('other topics are ignored', () => {
    expect(parse(fixture('notification-other-topic'))).toEqual({
      kind: 'ignored',
      externalType: 'merchant_order',
    });
  });
  it('the panel simulation (id 123456, test mode) is the transport test', () => {
    expect(
      parse(
        JSON.stringify({
          type: 'payment',
          live_mode: false,
          action: 'payment.updated',
          data: { id: '123456' },
        }),
      ),
    ).toEqual({ kind: 'test' });
  });
  it('a body without a type is the transport test', () => {
    expect(parse('{}')).toEqual({ kind: 'test' });
  });
  it('a payment notice without an id is unreadable, and so is invalid JSON', () => {
    expect(() => parse(JSON.stringify({ type: 'payment', data: {} }))).toThrow(
      ConnectorDataError,
    );
    expect(() => parse('nope')).toThrow();
  });
});

describe('MercadoPagoConnector.normalize', () => {
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const body = fixture('notification-payment-updated');
  const make = (answer: Record<string, unknown> | Error) => {
    const getPayment = jest.fn(() =>
      answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer),
    );
    const connector = new MercadoPagoConnector({
      getPayment,
    } as unknown as MercadoPagoClient);
    return {
      getPayment,
      run: () => connector.normalize({ connection, payload: body, delivery }),
    };
  };

  it('maps an approved payment with the payer, document, items and address', async () => {
    const { run, getPayment } = make(payment('payment-approved'));
    await expect(run()).resolves.toEqual({
      operationKey: 'mercadopago:999999999',
      commercialState: 'paid',
      externalRefs: {
        paymentId: '999999999',
        externalReference: 'PEDIDO-0001',
      },
      occurredAt: new Date('2026-11-20T10:05:10.000-03:00'),
      paidAt: new Date('2026-11-20T10:05:10.000-03:00'),
      currency: 'BRL',
      amountCents: 20000,
      discountCents: 0,
      customer: {
        name: 'Maria da Silva',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
        address: { street: 'Avenida Paulista, 1000', zip: '01310100' },
      },
      items: [
        {
          externalProductId: 'curso-01',
          description: 'Curso de Excel',
          quantity: 1,
        },
        {
          externalProductId: 'ebook-02',
          description: 'E-book bonus',
          quantity: 2,
        },
      ],
      description: 'Curso de Excel, E-book bonus',
      sellerIssuesInvoice: true,
    });
    expect(getPayment).toHaveBeenCalledWith('APP_USR-fake-token', '999999999');
  });
  it('a refund and a chargeback share the operation key of the payment', async () => {
    const paid = await make(payment('payment-approved')).run();
    const refunded = await make(payment('payment-refunded')).run();
    const back = await make(payment('payment-charged-back')).run();
    expect(refunded.operationKey).toBe(paid.operationKey);
    expect(back.operationKey).toBe(paid.operationKey);
    expect(refunded.commercialState).toBe('refunded');
    expect(refunded.occurredAt).toEqual(
      new Date('2026-11-22T09:00:00.000-03:00'),
    );
    expect(back.commercialState).toBe('disputed');
    expect(refunded.customer?.taxId).toBe('52998224725');
  });
  it('a payment that is not money yet stays pending, with a CNPJ normalized', async () => {
    const op = await make(payment('payment-pending')).run();
    expect(op).toMatchObject({
      commercialState: 'pending',
      amountCents: 9990,
      paidAt: null,
      description: 'Plano mensal',
      customer: { taxId: '11222333000181', name: null },
    });
  });
  it.each([
    ['cancelled', 'canceled'],
    ['rejected', 'canceled'],
    ['in_process', 'pending'],
    ['in_mediation', 'pending'],
    ['authorized', 'pending'],
  ])('status %s becomes %s', async (status, state) => {
    const op = await make({ ...payment('payment-approved'), status }).run();
    expect(op.commercialState).toBe(state);
  });
  it('a payment with no payer data has no customer', async () => {
    const op = await make(payment('payment-approved-no-payer')).run();
    expect(op.customer).toBeNull();
    expect(op.amountCents).toBe(2450);
    expect(op.description).toBe('Pago Pizza');
  });
  it('a document that is not CPF or CNPJ is not used', async () => {
    const op = await make({
      ...payment('payment-approved'),
      payer: {
        email: 'a@b.com',
        identification: { type: 'DNI', number: '12345678' },
      },
    }).run();
    expect(op.customer).toMatchObject({ email: 'a@b.com', taxId: null });
  });
  it('keeps the real currency so the planner can block anything but BRL', async () => {
    const op = await make({
      ...payment('payment-approved'),
      currency_id: 'ars',
    }).run();
    expect(op.currency).toBe('ARS');
  });
  it.each([[0], [-5], ['abc'], [null]])(
    'refuses an amount that is not positive (%s)',
    async (amount) => {
      await expect(
        make({
          ...payment('payment-approved'),
          transaction_amount: amount,
        }).run(),
      ).rejects.toThrow(ConnectorDataError);
    },
  );
  it('rounds reais to cents without float noise', async () => {
    const op = await make({
      ...payment('payment-approved'),
      transaction_amount: 19.99,
    }).run();
    expect(op.amountCents).toBe(1999);
  });
  it('refuses a connection without a token and a notice without an id', async () => {
    const connector = new MercadoPagoConnector({
      getPayment: jest.fn(),
    } as unknown as MercadoPagoClient);
    await expect(
      connector.normalize({
        connection: { ...connection, credentials: {} },
        payload: body,
        delivery,
      }),
    ).rejects.toThrow(ConnectorDataError);
    await expect(
      connector.normalize({
        connection,
        payload: JSON.stringify({ type: 'payment' }),
        delivery,
      }),
    ).rejects.toThrow(ConnectorDataError);
  });
  it('lets auth, data and transient failures propagate for the worker to handle', async () => {
    await expect(make(new ConnectorAuthError('401')).run()).rejects.toThrow(
      ConnectorAuthError,
    );
    await expect(make(new ConnectorDataError('400')).run()).rejects.toThrow(
      ConnectorDataError,
    );
    await expect(
      make(new ConnectorTransientError('503')).run(),
    ).rejects.toThrow(ConnectorTransientError);
  });
});

describe('MercadoPagoConnector.validateConnection', () => {
  it('asks Mercado Pago for the account and returns the user id', async () => {
    const getUserId = jest.fn().mockResolvedValue('44444');
    const connector = new MercadoPagoConnector({
      getUserId,
    } as unknown as MercadoPagoClient);
    await expect(
      connector.validateConnection(
        { accessToken: 'APP_USR-fake-token' },
        'live',
      ),
    ).resolves.toEqual({ externalAccountId: '44444' });
    expect(getUserId).toHaveBeenCalledWith('APP_USR-fake-token');
  });
  it('a refused token becomes an auth error', async () => {
    const connector = new MercadoPagoConnector({
      getUserId: jest.fn().mockRejectedValue(new ConnectorAuthError('401')),
    } as unknown as MercadoPagoClient);
    await expect(
      connector.validateConnection({ accessToken: 'x' }, 'live'),
    ).rejects.toThrow(ConnectorAuthError);
  });
});

describe('MercadoPagoConnector.manifest', () => {
  it('asks for the token first, the signing secret after the URL, and generates the URL secret', () => {
    const { manifest } = new MercadoPagoConnector();
    expect(manifest).toMatchObject({
      id: 'mercadopago',
      supportedFlows: ['payment'],
      webhookEvents: ['payment'],
    });
    expect(manifest.credentialFields).toEqual([
      expect.objectContaining({ key: 'accessToken', secret: true }),
      expect.objectContaining({
        key: 'webhookSigningSecret',
        secret: true,
        afterUrl: true,
      }),
      expect.objectContaining({
        key: 'webhookSecret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      }),
    ]);
    expect(manifest.webhookInstructions.pt).toContain('Assinatura secreta');
    expect(manifest.webhookInstructions.en).toContain('Secret signature');
  });
});
