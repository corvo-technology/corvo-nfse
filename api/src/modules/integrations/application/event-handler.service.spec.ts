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
