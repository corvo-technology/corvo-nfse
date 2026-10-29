import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WooviConnector } from './woovi.connector';
import type { WooviPublicKeyProvider } from './woovi-public-key.provider';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const sign = (body: string, privateKey: string) =>
  createSign('sha256').update(body).sign(privateKey, 'base64');

const connection: ConnectionView = {
  publicId: 'pub',
  environment: 'test',
  externalAccountId: 'woovi:abc',
  credentials: {},
};
const req = (body: string, signature?: string) => ({
  rawBody: Buffer.from(body),
  headers: signature ? { 'x-webhook-signature': signature } : {},
  query: {},
});

function setup(keys: string[][] = []) {
  const queue = [...keys];
  const provider = {
    getKeys: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]),
      ),
  } as unknown as WooviPublicKeyProvider & { getKeys: jest.Mock };
  return { connector: new WooviConnector(provider), provider };
}

describe('WooviConnector.authenticate', () => {
  const body = fixture('charge-completed.json');
  it('accepts a body signed with a published key', async () => {
    const { publicKey, privateKey } = keyPair();
    const { connector } = setup([[publicKey]]);
    await expect(
      connector.authenticate(req(body, sign(body, privateKey)), connection),
    ).resolves.toEqual({ ok: true });
  });
  it('accepts when any key of the list verifies (key rotation)', async () => {
    const other = keyPair();
    const current = keyPair();
    const { connector } = setup([[other.publicKey, current.publicKey]]);
    await expect(
      connector.authenticate(
        req(body, sign(body, current.privateKey)),
        connection,
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('rejects a body altered by one byte', async () => {
    const { publicKey, privateKey } = keyPair();
    const { connector } = setup([[publicKey]]);
    const result = await connector.authenticate(
      req(body + ' ', sign(body, privateKey)),
      connection,
    );
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a missing signature header without fetching keys', async () => {
    const { connector, provider } = setup([[keyPair().publicKey]]);
    await expect(
      connector.authenticate(req(body), connection),
    ).resolves.toEqual({ ok: false, reason: 'missing_signature' });
    expect(provider.getKeys).not.toHaveBeenCalled();
  });
  it('rejects a signature made by a key that is not published, after refreshing the list once', async () => {
    const stranger = keyPair();
    const { connector, provider } = setup([[keyPair().publicKey]]);
    const result = await connector.authenticate(
      req(body, sign(body, stranger.privateKey)),
      connection,
    );
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
    expect(provider.getKeys).toHaveBeenCalledTimes(2);
    expect(provider.getKeys).toHaveBeenNthCalledWith(2, 'test', true);
  });
  it('accepts a signature made with a key that only appears after the forced refresh', async () => {
    const rotated = keyPair();
    const { connector, provider } = setup([
      [keyPair().publicKey],
      [rotated.publicKey],
    ]);
    await expect(
      connector.authenticate(
        req(body, sign(body, rotated.privateKey)),
        connection,
      ),
    ).resolves.toEqual({ ok: true });
    expect(provider.getKeys).toHaveBeenCalledTimes(2);
  });
  it('garbage in the signature header is a plain rejection', async () => {
    const { connector } = setup([[keyPair().publicKey]]);
    await expect(
      connector.authenticate(req(body, '%%%not-base64%%%'), connection),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('WooviConnector.authenticate with the webhook token', () => {
  const body = fixture('charge-completed.json');
  const TOKEN = 'tok_0123456789abcdef';
  const withToken: ConnectionView = {
    ...connection,
    credentials: { webhookToken: TOKEN },
  };
  const request = (headers: Record<string, string>) => ({
    rawBody: Buffer.from(body),
    headers,
    query: {},
  });

  it('accepts the token in the Authorization header, with or without Bearer, even when no signature header comes', async () => {
    const { connector, provider } = setup([[keyPair().publicKey]]);
    for (const value of [TOKEN, `Bearer ${TOKEN}`])
      await expect(
        connector.authenticate(request({ authorization: value }), withToken),
      ).resolves.toEqual({ ok: true });
    expect(provider.getKeys).not.toHaveBeenCalled();
  });
  it('rejects a missing or wrong token, whatever the signature says', async () => {
    const { publicKey, privateKey } = keyPair();
    const { connector } = setup([[publicKey]]);
    const signature = sign(body, privateKey);
    const attempts: Array<Record<string, string>> = [
      { 'x-webhook-signature': signature },
      { authorization: 'nope', 'x-webhook-signature': signature },
      { authorization: `Bearer ${TOKEN}x` },
    ];
    for (const headers of attempts)
      await expect(
        connector.authenticate(request(headers), withToken),
      ).resolves.toEqual({ ok: false, reason: 'bad_token' });
  });
  it('a signature that comes must still be valid', async () => {
    const { connector } = setup([[keyPair().publicKey]]);
    await expect(
      connector.authenticate(
        request({ authorization: TOKEN, 'x-webhook-signature': 'AAAA' }),
        withToken,
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('accepts the token together with a valid signature', async () => {
    const { publicKey, privateKey } = keyPair();
    const { connector } = setup([[publicKey]]);
    await expect(
      connector.authenticate(
        request({
          authorization: TOKEN,
          'x-webhook-signature': sign(body, privateKey),
        }),
        withToken,
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('never puts the token in the rejection reason', async () => {
    const { connector } = setup();
    const result = await connector.authenticate(
      request({ authorization: `${TOKEN}x` }),
      withToken,
    );
    expect(JSON.stringify(result)).not.toContain('tok_');
  });
  it('generates the token, reveals it once and asks the client to put it in the Authorization header', () => {
    const { connector } = setup();
    expect(connector.manifest.credentialFields).toEqual([
      expect.objectContaining({
        key: 'webhookToken',
        secret: true,
        generate: true,
        revealOnce: true,
      }),
    ]);
    expect(connector.manifest.webhookInstructions.pt).toContain(
      'Authorization',
    );
    expect(connector.manifest.webhookInstructions.en).toContain(
      'Authorization',
    );
  });
});

describe('WooviConnector.parse', () => {
  const { connector } = setup();
  it('a completed charge is an operation with a stable delivery id', () => {
    const parsed = connector.parse(req(fixture('charge-completed.json')));
    expect(parsed).toEqual({
      kind: 'operation',
      deliveryId: 'OPENPIX:CHARGE_COMPLETED:pedido-123:tx-pix-1',
      externalType: 'OPENPIX:CHARGE_COMPLETED',
    });
    expect(connector.parse(req(fixture('charge-completed.json')))).toEqual(
      parsed,
    );
  });
  it('the paid-by-someone-else variant is also an operation', () => {
    const body = JSON.stringify({
      ...(JSON.parse(fixture('charge-completed.json')) as object),
      event: 'OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER',
    });
    expect(connector.parse(req(body))).toMatchObject({ kind: 'operation' });
  });
  it.each([
    'OPENPIX:CHARGE_CREATED',
    'OPENPIX:CHARGE_EXPIRED',
    'OPENPIX:TRANSACTION_RECEIVED',
    'PIX_TRANSACTION_REFUND_RECEIVED_CONFIRMED',
  ])('%s is ignored', (event) => {
    expect(
      connector.parse(req(JSON.stringify({ event, pix: { value: 1 } }))),
    ).toEqual({ kind: 'ignored', externalType: event });
  });
  it('a body without an event is the transport test of the webhook registration', () => {
    expect(
      connector.parse(req(JSON.stringify({ evento: 'teste_webhook' }))),
    ).toEqual({ kind: 'test' });
    expect(connector.parse(req('{}'))).toEqual({ kind: 'test' });
  });
  it('a completed event without a charge is unreadable', () => {
    expect(() =>
      connector.parse(
        req(JSON.stringify({ event: 'OPENPIX:CHARGE_COMPLETED', pix: {} })),
      ),
    ).toThrow();
  });
  it('invalid JSON is unreadable', () => {
    expect(() => connector.parse(req('not json'))).toThrow();
  });
});

describe('WooviConnector.normalize', () => {
  const { connector } = setup();
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'OPENPIX:CHARGE_COMPLETED',
  };
  const run = (body: string) =>
    connector.normalize({ connection, payload: body, delivery });

  it('maps the documented charge to the common operation', async () => {
    await expect(run(fixture('charge-completed.json'))).resolves.toEqual({
      operationKey: 'charge:pedido-123',
      commercialState: 'paid',
      externalRefs: {
        chargeCorrelationId: 'pedido-123',
        chargeTransactionId: 'tx-charge-1',
        pixTransactionId: 'tx-pix-1',
      },
      occurredAt: new Date('2026-10-29T15:00:00.000Z'),
      paidAt: new Date('2026-10-29T15:00:00.000Z'),
      currency: 'BRL',
      amountCents: 4990,
      discountCents: 0,
      customer: {
        name: 'Maria da Silva',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
      },
      items: [],
      description: 'Consultoria',
      sellerIssuesInvoice: true,
    });
  });
  it('uses the charge customer, never the Pix payer', async () => {
    const op = await run(fixture('charge-completed.json'));
    expect(op.customer?.name).toBe('Maria da Silva');
    expect(JSON.stringify(op)).not.toContain('Joao');
    expect(JSON.stringify(op)).not.toContain('11144477735');
  });
  it('accepts a taxID that is a plain string', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      charge: { customer: { taxID: unknown } };
    };
    data.charge.customer.taxID = '529.982.247-25';
    expect((await run(JSON.stringify(data))).customer?.taxId).toBe(
      '52998224725',
    );
  });
  it('keeps an alphanumeric CNPJ', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      charge: { customer: { taxID: unknown } };
    };
    data.charge.customer.taxID = '12.ABC.345/01DE-35';
    expect((await run(JSON.stringify(data))).customer?.taxId).toBe(
      '12ABC34501DE35',
    );
  });
  it('a masked taxID is flagged and not kept', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      charge: { customer: { taxID: unknown } };
    };
    data.charge.customer.taxID = '529.***.***-25';
    expect((await run(JSON.stringify(data))).customer).toMatchObject({
      taxId: null,
      taxIdMasked: true,
    });
  });
  it('no customer on the charge means no customer', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      charge: { customer?: unknown };
    };
    delete data.charge.customer;
    expect((await run(JSON.stringify(data))).customer).toBeNull();
  });
  it('a customer without a taxID has taxId null and is not masked', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      charge: { customer: { taxID?: unknown } };
    };
    delete data.charge.customer.taxID;
    expect((await run(JSON.stringify(data))).customer).toMatchObject({
      taxId: null,
      taxIdMasked: false,
    });
  });
  it.each([[49.9], ['4990'], [null], [undefined]])(
    'refuses a charge value that is not an integer number of cents (%s)',
    async (value) => {
      const data = JSON.parse(fixture('charge-completed.json')) as {
        charge: { value?: unknown };
      };
      data.charge.value = value;
      await expect(run(JSON.stringify(data))).rejects.toThrow(
        ConnectorDataError,
      );
    },
  );
  it('falls back to the charge update time when the payload has no pix time', async () => {
    const data = JSON.parse(fixture('charge-completed.json')) as {
      pix: { time?: unknown };
    };
    delete data.pix.time;
    expect((await run(JSON.stringify(data))).paidAt).toEqual(
      new Date('2026-10-29T15:00:05.000Z'),
    );
  });
});

describe('WooviConnector.normalize description', () => {
  const { connector } = setup();
  const delivery: OperationDelivery = {
    kind: 'operation',
    deliveryId: 'd',
    externalType: 'OPENPIX:CHARGE_COMPLETED',
  };
  const withComment = (comment: unknown) => {
    const body = JSON.parse(fixture('charge-completed.json')) as {
      charge: Record<string, unknown>;
    };
    body.charge.comment = comment;
    return connector.normalize({
      connection,
      payload: JSON.stringify(body),
      delivery,
    });
  };
  it('uses the charge comment as what was sold, trimmed', async () => {
    expect((await withComment('  Mentoria 1h  ')).description).toBe(
      'Mentoria 1h',
    );
  });
  it.each([[undefined], [''], ['   '], [42]])(
    'has no description when the comment is %s',
    async (comment) => {
      expect((await withComment(comment)).description).toBeNull();
    },
  );
});

describe('WooviConnector.validateConnection', () => {
  const { connector } = setup();
  it('needs no credential: the account id comes from the connection, stable and without exposing it', async () => {
    const first = await connector.validateConnection({}, 'live', {
      publicId: 'pub-1',
    });
    const again = await connector.validateConnection({}, 'test', {
      publicId: 'pub-1',
    });
    const other = await connector.validateConnection({}, 'live', {
      publicId: 'pub-2',
    });
    expect(first).toEqual(again);
    expect(first.externalAccountId).toMatch(/^woovi:[0-9a-f]{24}$/);
    expect(first.externalAccountId).not.toBe(other.externalAccountId);
    expect(first.externalAccountId).not.toContain('pub-1');
  });
});
