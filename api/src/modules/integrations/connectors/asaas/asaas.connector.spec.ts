import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planEmission } from '../../domain/emission-planner';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type ConnectionView,
  type InboundRequest,
  type NormalizedOperation,
  type OperationDelivery,
} from '../../domain/connector';
import type { IntegrationRule } from '../../domain/integration-rule';
import type { AsaasClient, AsaasCustomer } from './asaas.client';
import { AsaasConnector, ASAAS_TOKEN_HEADER } from './asaas.connector';

const TOKEN = 'tok_fake_0123456789abcdef0123456789';
const read = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const view = (
  credentials: Record<string, string>,
  environment: 'live' | 'test' = 'live',
): ConnectionView => ({
  publicId: 'pub',
  environment,
  externalAccountId: 'acc',
  credentials,
});
const request = (
  body: string,
  headers: Record<string, string | undefined> = {
    [ASAAS_TOKEN_HEADER]: TOKEN,
  },
): InboundRequest => ({ rawBody: Buffer.from(body), headers, query: {} });
const delivery: OperationDelivery = {
  kind: 'operation',
  deliveryId: 'd',
  externalType: 'x',
};

const customer: AsaasCustomer = {
  name: 'John Doe',
  email: 'john.doe@asaas.com.br',
  cpfCnpj: '249.715.637-92',
  address: { street: 'Av. Paulista, 150', city: 'São Paulo', state: 'SP' },
};

function build(getCustomer: jest.Mock = jest.fn().mockResolvedValue(customer)) {
  const client = { getCustomer, checkCredentials: jest.fn() };
  return {
    client,
    connector: new AsaasConnector(client as unknown as AsaasClient),
  };
}
const normalize = (
  connector: AsaasConnector,
  name: string,
  credentials: Record<string, string> = {
    webhookToken: TOKEN,
    access_token: 'fake_key',
  },
) =>
  connector.normalize({
    connection: view(credentials),
    payload: read(name),
    delivery,
  });

describe('AsaasConnector manifest', () => {
  const { connector } = build();
  it('generates and reveals once the webhook token, and the API key is optional', () => {
    const fields = connector.manifest.credentialFields;
    expect(fields.find((f) => f.key === 'webhookToken')).toMatchObject({
      secret: true,
      generate: true,
      revealOnce: true,
    });
    expect(fields.find((f) => f.key === 'access_token')).toMatchObject({
      secret: true,
      optional: true,
    });
  });
  it('lists the events to tick and warns about Asaas issuing its own invoice, in both languages', () => {
    expect(connector.manifest.webhookEvents).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REFUNDED',
      'PAYMENT_CHARGEBACK_REQUESTED',
    ]);
    expect(connector.manifest.webhookInstructions.pt).toContain(
      'emissão de nota fiscal do próprio Asaas',
    );
    expect(connector.manifest.webhookInstructions.en).toContain(
      "Asaas's own invoice issuing",
    );
  });
});

describe('AsaasConnector.authenticate', () => {
  const { connector } = build();
  const conn = view({ webhookToken: TOKEN });
  it('accepts the right token', async () => {
    await expect(connector.authenticate(request('{}'), conn)).resolves.toEqual({
      ok: true,
    });
  });
  it('rejects a missing header', async () => {
    await expect(
      connector.authenticate(request('{}', {}), conn),
    ).resolves.toEqual({ ok: false, reason: 'missing_token' });
  });
  it.each(['wrong', `${TOKEN}x`, ''])(
    'rejects the wrong token %p',
    async (sent) => {
      const result = await connector.authenticate(
        request('{}', { [ASAAS_TOKEN_HEADER]: sent || 'x' }),
        conn,
      );
      expect(result.ok).toBe(false);
    },
  );
  it('rejects everything when the connection has no token', async () => {
    await expect(
      connector.authenticate(request('{}'), view({})),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('AsaasConnector.parse', () => {
  const { connector } = build();
  it.each([
    ['payment-received', 'PAYMENT_RECEIVED', 'pay_080225913252'],
    ['payment-confirmed-boleto', 'PAYMENT_CONFIRMED', 'pay_8820000000002'],
    ['payment-refunded', 'PAYMENT_REFUNDED', 'pay_080225913252'],
    [
      'payment-chargeback-requested',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'pay_080225913252',
    ],
  ])('%s becomes an operation', (name, event, paymentId) => {
    expect(connector.parse(request(read(name)))).toEqual({
      kind: 'operation',
      deliveryId: `${paymentId}:${event}`,
      externalType: event,
    });
  });
  it('ignores events that are not a payment, a refund or a chargeback', () => {
    expect(connector.parse(request(read('payment-overdue')))).toEqual({
      kind: 'ignored',
      externalType: 'PAYMENT_OVERDUE',
    });
    expect(
      connector.parse(
        request(JSON.stringify({ event: 'PAYMENT_PARTIALLY_REFUNDED' })),
      ),
    ).toMatchObject({ kind: 'ignored' });
  });
  it('a body without an event is a test', () => {
    expect(connector.parse(request('{}'))).toEqual({ kind: 'test' });
  });
  it('a paid event without a payment id is a data error', () => {
    expect(() =>
      connector.parse(
        request(JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: {} })),
      ),
    ).toThrow(ConnectorDataError);
  });
});

describe('AsaasConnector.normalize', () => {
  it('a received payment becomes a paid sale with the customer looked up', async () => {
    const { connector, client } = build();
    const op = await normalize(connector, 'payment-received');
    expect(client.getCustomer).toHaveBeenCalledWith(
      'fake_key',
      'live',
      'cus_G7Dvo4iphUNk',
    );
    expect(op).toMatchObject({
      operationKey: 'asaas:pay_080225913252',
      commercialState: 'paid',
      amountCents: 10000,
      currency: 'BRL',
      description: 'Pedido 056984',
      sellerIssuesInvoice: true,
      externalRefs: {
        paymentId: 'pay_080225913252',
        customerId: 'cus_G7Dvo4iphUNk',
        externalReference: '056984',
      },
      customer: {
        name: 'John Doe',
        email: 'john.doe@asaas.com.br',
        taxId: '24971563792',
        taxIdMasked: false,
        address: { city: 'São Paulo', state: 'SP' },
      },
    });
    // 2024-06-12 16:45:03 in Brasilia time.
    expect(op.paidAt?.toISOString()).toBe('2024-06-12T19:45:03.000Z');
    expect(op.occurredAt).toEqual(op.paidAt);
  });

  it('turns reais with cents into integer cents', async () => {
    const op = await normalize(build().connector, 'payment-received-pix');
    expect(op.amountCents).toBe(4990);
    expect(op.description).toBeNull();
  });

  it('a test connection looks the customer up in the sandbox', async () => {
    const { connector, client } = build();
    await connector.normalize({
      connection: view({ webhookToken: TOKEN, access_token: 'k' }, 'test'),
      payload: read('payment-received'),
      delivery,
    });
    expect(client.getCustomer).toHaveBeenCalledWith(
      'k',
      'test',
      expect.any(String),
    );
  });

  it('without an API key there is no customer and no call', async () => {
    const { connector, client } = build();
    const op = await normalize(connector, 'payment-received', {
      webhookToken: TOKEN,
    });
    expect(op.customer).toBeNull();
    expect(client.getCustomer).not.toHaveBeenCalled();
  });

  it('a customer that cannot be read leaves the sale without customer', async () => {
    const { connector } = build(
      jest.fn().mockRejectedValue(new ConnectorDataError('Asaas answered 404')),
    );
    expect(
      (await normalize(connector, 'payment-received')).customer,
    ).toBeNull();
  });

  it('a customer without document keeps name and e-mail but no tax id', async () => {
    const { connector } = build(
      jest.fn().mockResolvedValue({ ...customer, cpfCnpj: null }),
    );
    const op = await normalize(connector, 'payment-received');
    expect(op.customer).toMatchObject({ name: 'John Doe', taxId: null });
  });

  it('a refused key and a transient failure stop the sale', async () => {
    await expect(
      normalize(
        build(jest.fn().mockRejectedValue(new ConnectorAuthError('x')))
          .connector,
        'payment-received',
      ),
    ).rejects.toThrow(ConnectorAuthError);
    await expect(
      normalize(
        build(jest.fn().mockRejectedValue(new ConnectorTransientError('x')))
          .connector,
        'payment-received',
      ),
    ).rejects.toThrow(ConnectorTransientError);
  });

  it('a refund names its sale by payment id and looks nothing up', async () => {
    const { connector, client } = build();
    const op = await normalize(connector, 'payment-refunded');
    expect(op).toMatchObject({
      operationKey: 'asaas:pay_080225913252',
      commercialState: 'refunded',
      refersTo: { ref: 'paymentId', value: 'pay_080225913252' },
      paidAt: null,
      customer: null,
    });
    expect(client.getCustomer).not.toHaveBeenCalled();
  });

  it('a chargeback is a dispute of that sale', async () => {
    const op = await normalize(
      build().connector,
      'payment-chargeback-requested',
    );
    expect(op).toMatchObject({
      commercialState: 'disputed',
      refersTo: { ref: 'paymentId', value: 'pay_080225913252' },
    });
  });

  it.each([0, -5, 'abc', null])('rejects the value %p', async (value) => {
    const body = JSON.parse(read('payment-received')) as {
      payment: { value: unknown };
    };
    body.payment.value = value;
    await expect(
      build().connector.normalize({
        connection: view({ webhookToken: TOKEN }),
        payload: JSON.stringify(body),
        delivery,
      }),
    ).rejects.toThrow(ConnectorDataError);
  });

  it('never leaves the API key or the token in an operation', async () => {
    const op = await normalize(build().connector, 'payment-received');
    const text = JSON.stringify(op);
    expect(text).not.toContain('fake_key');
    expect(text).not.toContain(TOKEN);
  });
});

describe('AsaasConnector.validateConnection', () => {
  it('derives a stable account id from the token and checks the key when there is one', async () => {
    const { connector, client } = build();
    const a = await connector.validateConnection(
      { webhookToken: TOKEN, access_token: 'k' },
      'live',
    );
    const b = await connector.validateConnection(
      { webhookToken: TOKEN },
      'live',
    );
    expect(a.externalAccountId).toMatch(/^asaas:[0-9a-f]{24}$/);
    expect(a).toEqual(b);
    expect(client.checkCredentials).toHaveBeenCalledTimes(1);
    expect(client.checkCredentials).toHaveBeenCalledWith('k', 'live');
  });
  it('a refused key fails the validation', async () => {
    const { connector, client } = build();
    client.checkCredentials.mockRejectedValue(new ConnectorAuthError('x'));
    await expect(
      connector.validateConnection(
        { webhookToken: TOKEN, access_token: 'bad' },
        'live',
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });
});

describe('a sale without customer data', () => {
  const rule: IntegrationRule = {
    id: 'r',
    tenantId: 't',
    connectionId: 'c',
    externalProductId: null,
    service: {},
    sendEmail: true,
    allowAnonymousCustomer: false,
    cancelOnRefund: false,
  };
  const plan = (operation: NormalizedOperation) =>
    planEmission({
      tenantId: 't',
      provider: 'asaas',
      connection: {
        id: 'c',
        companyId: 'co',
        state: 'active',
        activeFrom: null,
        environment: 'live',
        externalAccountId: 'acc',
      },
      operation: {
        snapshot: operation,
        commercialState: operation.commercialState,
      },
      rules: [rule],
    });

  it('without the API key the sale waits for the client to complete it', async () => {
    const op = await normalize(build().connector, 'payment-received', {
      webhookToken: TOKEN,
    });
    expect(plan(op).kind).not.toBe('issue');
  });
  it('a customer with a document and no e-mail is issued without sending', async () => {
    const { connector } = build(
      jest.fn().mockResolvedValue({ ...customer, email: null }),
    );
    const result = plan(await normalize(connector, 'payment-received'));
    expect(result.kind).toBe('issue');
    if (result.kind === 'issue') expect(result.request.email).toBe(false);
  });
});
