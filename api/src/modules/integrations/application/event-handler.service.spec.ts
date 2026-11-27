import { EventHandlerService } from './event-handler.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type Connector,
  type NormalizedOperation,
} from '../domain/connector';
import { MemoryOperations } from '../testing/memory-repositories';
import type { ConnectionService } from './connection.service';
import type { OperationEmitter } from './operation-emitter.service';
import type { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import type { ClaimedEvent } from '../domain/integration-event.repository';

const TENANT = '11111111-1111-4111-8111-111111111111';
const event: ClaimedEvent = {
  id: 'e1',
  tenantId: TENANT,
  connectionId: 'c1',
  provider: 'fake',
  payloadEnc: 'enc:{"id":"d1"}',
  attempts: 1,
  claimToken: 't',
};
const normalized: NormalizedOperation = {
  operationKey: 'charge:1',
  commercialState: 'paid',
  externalRefs: {},
  occurredAt: new Date(),
  paidAt: new Date(),
  currency: 'BRL',
  amountCents: 100,
  discountCents: 0,
  customer: null,
  items: [],
  sellerIssuesInvoice: true,
};

function setup(normalize: Connector['normalize']) {
  const connector: Connector = {
    manifest: {
      id: 'fake',
      name: 'F',
      version: '1',
      credentialFields: [],
      webhookInstructions: { pt: '', en: '' },
      supportedFlows: [],
    },
    authenticate: () => Promise.resolve({ ok: true }),
    parse: () => ({
      kind: 'operation',
      deliveryId: 'd1',
      externalType: 'paid',
    }),
    normalize,
    validateConnection: () => Promise.resolve({ externalAccountId: 'acc' }),
  };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const connection = {
    id: 'c1',
    tenantId: TENANT,
    provider: 'fake',
    environment: 'test',
    externalAccountId: 'acc',
    state: 'active',
  };
  const connections = {
    get: jest.fn().mockResolvedValue(connection),
    toView: () => ({
      publicId: 'p',
      environment: 'test',
      externalAccountId: 'acc',
      credentials: {},
    }),
    requireReauth: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConnectionService & { requireReauth: jest.Mock };
  const operations = new MemoryOperations();
  const emitter = {
    run: jest
      .fn()
      .mockResolvedValue({ state: 'processed', operationId: 'op1' }),
  } as unknown as OperationEmitter & { run: jest.Mock };
  const cipher = {
    decrypt: (s: string) => s.replace(/^enc:/, ''),
  } as unknown as SecretsCipherService;
  return {
    handler: new EventHandlerService(
      registry,
      connections,
      operations,
      emitter,
      cipher,
    ),
    connections,
    operations,
    emitter,
  };
}

describe('EventHandlerService with an event that only names the original payment', () => {
  const sale: NormalizedOperation = {
    ...normalized,
    operationKey: 'charge:pedido-123',
    externalRefs: {
      pixEndToEndId: 'E-ORIG',
      chargeCorrelationId: 'pedido-123',
    },
    customer: {
      name: 'Maria',
      email: null,
      taxId: '52998224725',
      taxIdMasked: false,
    },
    description: 'Consultoria',
    amountCents: 4990,
  };
  const refund: NormalizedOperation = {
    operationKey: 'refund:E-ORIG',
    commercialState: 'refunded',
    externalRefs: {},
    refersTo: { ref: 'pixEndToEndId', value: 'E-ORIG' },
    occurredAt: new Date('2099-01-01T00:00:00Z'),
    paidAt: null,
    currency: 'BRL',
    amountCents: 4990,
    discountCents: 0,
    customer: null,
    items: [],
    sellerIssuesInvoice: true,
  };
  const existing = (operations: MemoryOperations) =>
    operations.upsertFromNormalized({
      tenantId: TENANT,
      connectionId: 'c1',
      provider: 'fake',
      environment: 'test',
      externalAccountId: 'acc',
      normalized: sale,
    });

  it('finds the sale, marks it refunded and keeps what the sale knew', async () => {
    const { handler, operations, emitter } = setup(
      jest.fn().mockResolvedValue(refund),
    );
    const original = await existing(operations);
    await handler.handle(event);
    expect(operations.rows.size).toBe(1);
    const stored = operations.rows.get(original.id)!;
    expect(stored.commercialState).toBe('refunded');
    expect(stored.operationKey).toBe('charge:pedido-123');
    expect(stored.snapshot).toMatchObject({
      customer: { name: 'Maria' },
      description: 'Consultoria',
      amountCents: 4990,
    });
    expect(emitter.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.id }),
    );
  });

  it('still finds a sale whose buyer and raw data were erased by the retention job', async () => {
    // The shape notice-retention.ts leaves behind: references, state, dates and amount stay.
    const erasedSale = {
      ...sale,
      customer: null,
      description: undefined,
      items: [{ externalProductId: 'prod-1', description: null, quantity: 1 }],
      erased: true,
    } as NormalizedOperation;
    const { handler, operations, emitter } = setup(
      jest.fn().mockResolvedValue(refund),
    );
    const original = await operations.upsertFromNormalized({
      tenantId: TENANT,
      connectionId: 'c1',
      provider: 'fake',
      environment: 'test',
      externalAccountId: 'acc',
      normalized: erasedSale,
    });
    await handler.handle(event);
    expect(operations.rows.size).toBe(1);
    const stored = operations.rows.get(original.id)!;
    expect(stored.commercialState).toBe('refunded');
    expect(stored.operationKey).toBe('charge:pedido-123');
    expect(stored.snapshot.items).toEqual(erasedSale.items);
    expect(emitter.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.id }),
    );
  });

  it('a refund for a payment the sale list does not know is ignored, saying why, and creates nothing', async () => {
    const { handler, operations, emitter } = setup(
      jest.fn().mockResolvedValue(refund),
    );
    await expect(handler.handle(event)).resolves.toEqual({
      state: 'ignored',
      lastError: 'refund_sale_not_found',
    });
    expect(operations.rows.size).toBe(0);
    expect(emitter.run).not.toHaveBeenCalled();
  });

  it('only looks among the sales of this connection', async () => {
    const { handler, operations } = setup(jest.fn().mockResolvedValue(refund));
    await operations.upsertFromNormalized({
      tenantId: TENANT,
      connectionId: 'another-connection',
      provider: 'fake',
      environment: 'test',
      externalAccountId: 'acc',
      normalized: sale,
    });
    await expect(handler.handle(event)).resolves.toMatchObject({
      state: 'ignored',
    });
  });
});

describe('EventHandlerService', () => {
  it('normalizes the stored payload, stores the operation and hands it to the emitter', async () => {
    const normalize = jest.fn().mockResolvedValue(normalized);
    const { handler, operations, emitter } = setup(normalize);
    const outcome = await handler.handle(event);
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: '{"id":"d1"}',
        delivery: expect.objectContaining({ deliveryId: 'd1' }),
      }),
    );
    expect(operations.rows.size).toBe(1);
    expect(emitter.run).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ state: 'processed' });
  });

  it('ConnectorAuthError moves the connection to reauth_required and needs attention', async () => {
    const { handler, connections } = setup(() =>
      Promise.reject(new ConnectorAuthError('key revoked')),
    );
    await expect(handler.handle(event)).resolves.toEqual({
      state: 'needs_attention',
      lastError: 'key revoked',
    });
    expect(connections.requireReauth).toHaveBeenCalled();
  });

  it('ConnectorDataError becomes needs_attention with the message', async () => {
    const { handler } = setup(() =>
      Promise.reject(new ConnectorDataError('missing amount')),
    );
    await expect(handler.handle(event)).resolves.toEqual({
      state: 'needs_attention',
      lastError: 'missing amount',
    });
  });

  it('ConnectorTransientError and unexpected errors propagate for retry', async () => {
    await expect(
      setup(() =>
        Promise.reject(new ConnectorTransientError('503')),
      ).handler.handle(event),
    ).rejects.toThrow('503');
    await expect(
      setup(() => Promise.reject(new Error('boom'))).handler.handle(event),
    ).rejects.toThrow('boom');
  });
});
