import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbacatePayConnector } from './abacatepay.connector';
import type { AbacatePayClient } from './abacatepay.client';
import {
  ConnectorDataError,
  ConnectorAuthError,
  ConnectorTransientError,
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

describe('AbacatePayConnector.authenticate with Standard Webhooks', () => {
  const body = fixture('checkout-completed');
  const connector = new AbacatePayConnector(undefined);
  const secretBytes = Buffer.from('0123456789abcdef0123456789abcdef');
  const whsec = `whsec_${secretBytes.toString('base64')}`;
  const sign = (
    key: Buffer | string,
    id: string,
    timestamp: string,
    payload = body,
  ) =>
    `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')}`;
  const now = () => String(Math.floor(Date.now() / 1000));
  const std = (
    key: Buffer | string,
    over: { timestamp?: string; signature?: string; payload?: string } = {},
  ) => {
    const timestamp = over.timestamp ?? now();
    return {
      rawBody: Buffer.from(over.payload ?? body),
      headers: {
        'webhook-id': 'msg_1',
        'webhook-timestamp': timestamp,
        'webhook-signature':
          over.signature ?? sign(key, 'msg_1', timestamp, body),
      },
      query: {},
    };
  };
  const withSecret = (webhookSecret: string): ConnectionView => ({
    ...connection,
    credentials: { webhookSecret },
  });

  it('accepts a whsec_ secret (key is the base64-decoded part) with no secret in the URL', async () => {
    await expect(
      connector.authenticate(std(secretBytes), withSecret(whsec)),
    ).resolves.toEqual({ ok: true });
  });
  it('accepts a plain secret used as it is', async () => {
    await expect(
      connector.authenticate(
        std('S3CRET-0123456789'),
        withSecret('S3CRET-0123456789'),
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('accepts when any of several space-separated signatures matches', async () => {
    const good = sign(secretBytes, 'msg_1', now());
    await expect(
      connector.authenticate(
        std(secretBytes, { signature: `v1,AAAA ${good}` }),
        withSecret(whsec),
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a wrong signature and a body altered by one byte', async () => {
    await expect(
      connector.authenticate(
        std(secretBytes, { signature: 'v1,AAAA' }),
        withSecret(whsec),
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    const request = std(secretBytes);
    request.rawBody = Buffer.from(body + ' ');
    await expect(
      connector.authenticate(request, withSecret(whsec)),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a signature made with another secret', async () => {
    await expect(
      connector.authenticate(std(Buffer.from('other')), withSecret(whsec)),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a timestamp outside five minutes, old or in the future, even if the signature is right', async () => {
    for (const offset of [-301, 301]) {
      const timestamp = String(Math.floor(Date.now() / 1000) + offset);
      await expect(
        connector.authenticate(
          std(secretBytes, { timestamp }),
          withSecret(whsec),
        ),
      ).resolves.toEqual({ ok: false, reason: 'stale_timestamp' });
    }
    await expect(
      connector.authenticate(
        std(secretBytes, { timestamp: 'abc' }),
        withSecret(whsec),
      ),
    ).resolves.toEqual({ ok: false, reason: 'stale_timestamp' });
  });
  it('without those headers the legacy secret in the URL still works', async () => {
    await expect(
      connector.authenticate(req(body, { signature: null }), connection),
    ).resolves.toEqual({ ok: true });
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
      description: null,
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
  it('an upsell is part of the same sale, so it keeps the same operation (one invoice per checkout)', async () => {
    const data = JSON.parse(fixture('checkout-completed')) as {
      data: { isUpSell?: boolean };
    };
    data.data.isUpSell = true;
    expect((await run(JSON.stringify(data))).operationKey).toBe(
      'checkout:bill_abc123xyz',
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

describe('AbacatePayConnector.normalize with an API key', () => {
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const keyed: ConnectionView = {
    ...connection,
    credentials: { ...connection.credentials, apiKey: 'abc_key' },
  };
  const make = (getCustomer: jest.Mock) =>
    new AbacatePayConnector(undefined, {
      getCustomer,
    } as unknown as AbacatePayClient);
  const run = (c: AbacatePayConnector, conn = keyed) =>
    c.normalize({
      connection: conn,
      payload: fixture('checkout-completed'),
      delivery,
    });

  it('reads the full document from AbacatePay when the webhook masked it', async () => {
    const getCustomer = jest.fn().mockResolvedValue({
      name: 'Maria da Silva',
      email: 'maria@example.com',
      taxId: '52998224725',
    });
    const op = await run(make(getCustomer));
    expect(getCustomer).toHaveBeenCalledWith('abc_key', 'cust_1');
    expect(op.customer).toEqual({
      name: 'Maria da Silva',
      email: 'maria@example.com',
      taxId: '52998224725',
      taxIdMasked: false,
    });
  });
  it('does not call the API when the document already came complete', async () => {
    const getCustomer = jest.fn();
    await make(getCustomer).normalize({
      connection: keyed,
      payload: fixture('transparent-completed'),
      delivery,
    });
    expect(getCustomer).not.toHaveBeenCalled();
  });
  it('keeps the masked customer when the connection has no key', async () => {
    const getCustomer = jest.fn();
    const op = await run(make(getCustomer), connection);
    expect(getCustomer).not.toHaveBeenCalled();
    expect(op.customer?.taxIdMasked).toBe(true);
  });
  it('keeps it masked when AbacatePay has no document for that customer', async () => {
    const op = await run(
      make(
        jest.fn().mockResolvedValue({ name: null, email: null, taxId: null }),
      ),
    );
    expect(op.customer).toMatchObject({ taxId: null, taxIdMasked: true });
  });
  it('lets lookup failures propagate so the worker retries or asks for a new key', async () => {
    await expect(
      run(
        make(jest.fn().mockRejectedValue(new ConnectorTransientError('503'))),
      ),
    ).rejects.toThrow(ConnectorTransientError);
  });
});

describe('AbacatePayConnector.normalize description from the products', () => {
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'x',
  };
  const keyed: ConnectionView = {
    ...connection,
    credentials: { ...connection.credentials, apiKey: 'abc_key' },
  };
  const make = (getProductName: jest.Mock) =>
    new AbacatePayConnector(undefined, {
      getProductName,
      getCustomer: jest
        .fn()
        .mockResolvedValue({ name: null, email: null, taxId: null }),
    } as unknown as AbacatePayClient);
  const run = (c: AbacatePayConnector, conn = keyed) =>
    c.normalize({
      connection: conn,
      payload: fixture('checkout-completed'),
      delivery,
    });

  it('names the sale after the product, and the item after it too', async () => {
    const getProductName = jest.fn().mockResolvedValue('Plano Pro');
    const op = await run(make(getProductName));
    expect(getProductName).toHaveBeenCalledWith('abc_key', 'prod_consultoria');
    expect(op.description).toBe('Plano Pro');
    expect(op.items[0]).toMatchObject({
      externalProductId: 'prod_consultoria',
      description: 'Plano Pro',
    });
  });
  it('joins several different products and asks for each only once', async () => {
    const data = JSON.parse(fixture('checkout-completed')) as {
      data: { checkout: { items: unknown[] } };
    };
    data.data.checkout.items = [
      { id: 'p1', quantity: 1 },
      { id: 'p2', quantity: 2 },
      { id: 'p1', quantity: 1 },
    ];
    const getProductName = jest
      .fn()
      .mockImplementation((_k: string, id: string) =>
        Promise.resolve(id === 'p1' ? 'Plano Pro' : 'Extra'),
      );
    const op = await make(getProductName).normalize({
      connection: keyed,
      payload: JSON.stringify(data),
      delivery,
    });
    expect(getProductName).toHaveBeenCalledTimes(2);
    expect(op.description).toBe('Plano Pro, Extra');
  });
  it('has no description without a key', async () => {
    const getProductName = jest.fn();
    const op = await run(make(getProductName), connection);
    expect(getProductName).not.toHaveBeenCalled();
    expect(op.description).toBeNull();
  });
  it('a key without permission on products still lets the sale through, without a description', async () => {
    const op = await run(
      make(jest.fn().mockRejectedValue(new ConnectorAuthError('403'))),
    );
    expect(op.description).toBeNull();
  });
  it('lets a transient failure propagate so the worker retries', async () => {
    await expect(
      run(
        make(jest.fn().mockRejectedValue(new ConnectorTransientError('503'))),
      ),
    ).rejects.toThrow(ConnectorTransientError);
  });
});

describe('AbacatePayConnector.validateConnection', () => {
  const checkCredentials = jest.fn().mockResolvedValue(undefined);
  const connector = new AbacatePayConnector(undefined, {
    checkCredentials,
  } as unknown as AbacatePayClient);
  it('checks the API key with AbacatePay', async () => {
    await connector.validateConnection(
      { webhookSecret: 'one', apiKey: 'abc_key' },
      'live',
    );
    expect(checkCredentials).toHaveBeenCalledWith('abc_key');
  });
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
