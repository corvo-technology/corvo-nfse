import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbacatePayConnector } from './abacatepay.connector';
import {
  ConnectorDataError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const HMAC_KEY = 'public-key-from-abacatepay';
const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'abacatepay:x',
  credentials: { webhookSecret: 'S3CRET-0123456789' },
};
const hmac = (body: string, key = HMAC_KEY) =>
  createHmac('sha256', key).update(body).digest('base64');
const req = (
  body: string,
  over: { secret?: string | null; signature?: string | null } = {},
) => ({
  rawBody: Buffer.from(body),
  headers:
    over.signature === null
      ? {}
      : { 'x-webhook-signature': over.signature ?? hmac(body) },
  query:
    over.secret === null
      ? {}
      : { webhookSecret: over.secret ?? 'S3CRET-0123456789' },
});

describe('AbacatePayConnector.authenticate', () => {
  const body = fixture('checkout-completed');
  const withKey = new AbacatePayConnector(HMAC_KEY);
  const withoutKey = new AbacatePayConnector(undefined);

  it('accepts the right secret with a valid signature', async () => {
    await expect(withKey.authenticate(req(body), connection)).resolves.toEqual({
      ok: true,
    });
  });
  it('rejects the right signature with the wrong secret', async () => {
    await expect(
      withKey.authenticate(req(body, { secret: 'wrong' }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('rejects a missing secret', async () => {
    await expect(
      withKey.authenticate(req(body, { secret: null }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('rejects the right secret with a wrong signature or a missing one', async () => {
    await expect(
      withKey.authenticate(req(body, { signature: 'AAAA' }), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    await expect(
      withKey.authenticate(req(body, { signature: null }), connection),
    ).resolves.toEqual({ ok: false, reason: 'missing_signature' });
  });
  it('rejects a body altered by one byte', async () => {
    await expect(
      withKey.authenticate(
        req(body + ' ', { signature: hmac(body) }),
        connection,
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('relies on the secret alone while no public key is configured', async () => {
    await expect(
      withoutKey.authenticate(req(body, { signature: null }), connection),
    ).resolves.toEqual({ ok: true });
    await expect(
      withoutKey.authenticate(
        req(body, { secret: 'wrong', signature: null }),
        connection,
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('uses a constant-time comparison for the secret', async () => {
    const crypto =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    await withKey.authenticate(req(body), connection);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('never puts the secret in the rejection reason', async () => {
    const result = await withKey.authenticate(
      req(body, { secret: 'S3CRET-0123456789x' }),
      connection,
    );
    expect(JSON.stringify(result)).not.toContain('S3CRET');
  });
});

describe('AbacatePayConnector.parse', () => {
  const connector = new AbacatePayConnector(undefined);
  it.each([
    ['checkout-completed', 'checkout.completed', 'log_abc123xyz', 'live'],
    ['transparent-completed', 'transparent.completed', 'log_tr1', 'test'],
  ])(
    '%s is an operation keyed by the envelope id, with the environment from devMode',
    (name, type, id, environment) => {
      expect(connector.parse(req(fixture(name)))).toEqual({
        kind: 'operation',
        deliveryId: id,
        externalType: type,
        environment,
      });
    },
  );
  it.each(['checkout-refunded', 'checkout-disputed'])(
    '%s is an operation too',
    (name) => {
      expect(connector.parse(req(fixture(name))).kind).toBe('operation');
    },
  );
  it.each([
    'subscription.completed',
    'transfer.completed',
    'payout.failed',
    'pix_key.received',
  ])('%s is ignored', (event) => {
    expect(
      connector.parse(
        req(
          JSON.stringify({
            id: 'x',
            event,
            apiVersion: 2,
            devMode: false,
            data: {},
          }),
        ),
      ),
    ).toEqual({ kind: 'ignored', externalType: event });
  });
  it('a body without an event is the transport test', () => {
    expect(connector.parse(req('{}'))).toEqual({ kind: 'test' });
  });
  it('an operation event without an id is unreadable', () => {
    expect(() =>
      connector.parse(
        req(JSON.stringify({ event: 'checkout.completed', data: {} })),
      ),
    ).toThrow(ConnectorDataError);
  });
  it('invalid JSON is unreadable', () => {
    expect(() => connector.parse(req('nope'))).toThrow();
  });
});

describe('AbacatePayConnector.normalize', () => {
  const connector = new AbacatePayConnector(undefined);
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const run = (body: string) =>
    connector.normalize({ connection, payload: body, delivery });

  it('maps a completed checkout', async () => {
    await expect(run(fixture('checkout-completed'))).resolves.toEqual({
      operationKey: 'checkout:bill_abc123xyz',
      commercialState: 'paid',
      externalRefs: { checkoutId: 'bill_abc123xyz', externalId: 'pedido-123' },
      occurredAt: new Date('2026-10-29T15:00:00.000Z'),
      paidAt: new Date('2026-10-29T15:00:00.000Z'),
      currency: 'BRL',
      amountCents: 10000,
      discountCents: 0,
      customer: {
        name: 'Maria da Silva',
        email: 'maria@example.com',
        taxId: null,
        taxIdMasked: true,
      },
      items: [
        {
          externalProductId: 'prod_consultoria',
          description: null,
          quantity: 1,
        },
      ],
      sellerIssuesInvoice: true,
    });
  });
  it('maps a completed transparent payment with a full document and no items', async () => {
    const op = await run(fixture('transparent-completed'));
    expect(op).toMatchObject({
      operationKey: 'transparent:pix_char_1',
      commercialState: 'paid',
      amountCents: 2500,
      items: [],
      customer: { taxId: '52998224725', taxIdMasked: false },
      externalRefs: { transparentId: 'pix_char_1' },
    });
  });
  it('refunded and disputed share the operation key of the payment', async () => {
    const paid = await run(fixture('checkout-completed'));
    const refunded = await run(fixture('checkout-refunded'));
    const disputed = await run(fixture('checkout-disputed'));
    expect(refunded.operationKey).toBe(paid.operationKey);
    expect(disputed.operationKey).toBe(paid.operationKey);
    expect(refunded.commercialState).toBe('refunded');
    expect(disputed.commercialState).toBe('disputed');
  });
  it('the event name, not the object status, decides the commercial state', async () => {
    const data = JSON.parse(fixture('checkout-completed')) as {
      data: { checkout: { status: string } };
    };
    data.data.checkout.status = 'REFUNDED';
    expect((await run(JSON.stringify(data))).commercialState).toBe('paid');
  });
  it('a null customer stays null', async () => {
    const data = JSON.parse(fixture('checkout-completed')) as {
      data: { customer: unknown };
    };
    data.data.customer = null;
    expect((await run(JSON.stringify(data))).customer).toBeNull();
  });
  it('an upsell completion is a separate operation from the main purchase', async () => {
    const data = JSON.parse(fixture('checkout-completed')) as {
      data: { isUpSell?: boolean };
    };
    data.data.isUpSell = true;
    expect((await run(JSON.stringify(data))).operationKey).toBe(
      'checkout:bill_abc123xyz:upsell',
    );
  });
  it.each([[100.5], ['10000'], [0], [-1], [null]])(
    'refuses an amount that is not a positive integer of cents (%s)',
    async (amount) => {
      const data = JSON.parse(fixture('checkout-completed')) as {
        data: { checkout: { amount: unknown } };
      };
      data.data.checkout.amount = amount;
      await expect(run(JSON.stringify(data))).rejects.toThrow(
        ConnectorDataError,
      );
    },
  );
  it('refuses a payload with neither checkout nor transparent', async () => {
    await expect(
      run(JSON.stringify({ id: 'x', event: 'checkout.completed', data: {} })),
    ).rejects.toThrow(ConnectorDataError);
  });
});

describe('AbacatePayConnector.validateConnection', () => {
  const connector = new AbacatePayConnector(undefined);
  it('derives a stable account id from the webhook secret, without exposing it', async () => {
    const a = await connector.validateConnection(
      { webhookSecret: 'one' },
      'live',
    );
    const again = await connector.validateConnection(
      { webhookSecret: 'one' },
      'live',
    );
    const b = await connector.validateConnection(
      { webhookSecret: 'two' },
      'live',
    );
    expect(a).toEqual(again);
    expect(a.externalAccountId).toMatch(/^abacatepay:[0-9a-f]{24}$/);
    expect(a.externalAccountId).not.toBe(b.externalAccountId);
    expect(a.externalAccountId).not.toContain('one');
  });
});
