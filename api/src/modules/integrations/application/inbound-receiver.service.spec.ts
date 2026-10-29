import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InboundReceiverService } from './inbound-receiver.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import type {
  Connector,
  InboundRequest,
  ParsedDelivery,
  DeliveryAuth,
} from '../domain/connector';
import type { IntegrationConnection } from '../domain/integration-connection';
import { IIntegrationEventRepository } from '../domain/integration-event.repository';
import type { ConnectionService } from './connection.service';
import type { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

class MemoryEvents extends IIntegrationEventRepository {
  rows: Array<Record<string, unknown>> = [];
  fail = false;
  resolveAttention() {
    return Promise.resolve();
  }
  insertReceived(
    input: Parameters<IIntegrationEventRepository['insertReceived']>[0],
  ) {
    if (this.fail) return Promise.reject(new Error('db down'));
    const dup = this.rows.some(
      (r) =>
        r.deliveryId === input.deliveryId &&
        r.externalAccountId === input.externalAccountId,
    );
    if (dup) return Promise.resolve({ id: 'x', created: false });
    this.rows.push({ ...input });
    return Promise.resolve({ id: `e${this.rows.length}`, created: true });
  }
  claimBatch() {
    return Promise.resolve([]);
  }
  markResult() {
    return Promise.resolve(true);
  }
  listByConnection() {
    return Promise.resolve([]);
  }
  findById() {
    return Promise.resolve(null);
  }
  requeue() {
    return Promise.resolve();
  }
}

function connection(
  over: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: 'c1',
    tenantId: TENANT,
    companyId: 'co',
    publicId: 'pub',
    provider: 'fake',
    environment: 'test',
    externalAccountId: 'acc',
    state: 'active',
    credentialsEnc: 'enc',
    activeFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function setup(
  opts: {
    conn?: IntegrationConnection | null;
    auth?: DeliveryAuth;
    parse?: () => ParsedDelivery;
  } = {},
) {
  const connector: Connector = {
    manifest: {
      id: 'fake',
      name: 'Fake',
      version: '1',
      credentialFields: [],
      webhookInstructions: { pt: '', en: '' },
      supportedFlows: [],
    },
    authenticate: () => Promise.resolve(opts.auth ?? { ok: true }),
    parse:
      opts.parse ??
      (() => ({ kind: 'operation', deliveryId: 'd1', externalType: 'paid' })),
    normalize: () => Promise.reject(new Error('unused')),
    validateConnection: () => Promise.resolve({ externalAccountId: 'acc' }),
  };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const events = new MemoryEvents();
  const conn = opts.conn === undefined ? connection() : opts.conn;
  const connections = {
    findByPublicId: jest.fn().mockResolvedValue(conn),
    toView: () => ({
      publicId: 'pub',
      environment: 'test',
      externalAccountId: 'acc',
      credentials: {},
    }),
  } as unknown as ConnectionService;
  const cipher = {
    encrypt: (s: string) => `enc:${Buffer.from(s).toString('base64')}`,
  } as unknown as SecretsCipherService;
  return {
    service: new InboundReceiverService(registry, connections, events, cipher),
    events,
  };
}

const req = (body = '{"a":1}'): InboundRequest => ({
  rawBody: Buffer.from(body),
  headers: {},
  query: {},
});

describe('InboundReceiverService', () => {
  it('returns 401 and stores nothing when authenticate says not ok', async () => {
    const { service, events } = setup({
      auth: { ok: false, reason: 'bad_signature' },
    });
    await expect(service.receive('pub', req())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(events.rows).toHaveLength(0);
  });

  it.each([
    ['unknown', null],
    ['disconnected', connection({ state: 'disconnected' })],
    ['draft', connection({ state: 'draft' })],
  ])('returns the same not found for %s connections', async (_n, conn) => {
    const { service } = setup({ conn });
    const error = await service.receive('pub', req()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('Not found');
  });

  it('stores a received event for an operation delivery', async () => {
    const { service, events } = setup();
    await expect(service.receive('pub', req())).resolves.toEqual({
      status: 'accepted',
    });
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      tenantId: TENANT,
      connectionId: 'c1',
      provider: 'fake',
      environment: 'test',
      externalAccountId: 'acc',
      deliveryId: 'd1',
      state: 'received',
    });
  });

  it('answers duplicate and keeps one row when the same delivery arrives twice, even in parallel', async () => {
    const { service, events } = setup();
    const results = await Promise.all([
      service.receive('pub', req()),
      service.receive('pub', req()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'accepted',
      'duplicate',
    ]);
    expect(events.rows).toHaveLength(1);
  });

  it('answers test and stores nothing for kind test', async () => {
    const { service, events } = setup({ parse: () => ({ kind: 'test' }) });
    await expect(service.receive('pub', req())).resolves.toEqual({
      status: 'test',
    });
    expect(events.rows).toHaveLength(0);
  });

  it('answers ignored and stores nothing for kind ignored', async () => {
    const { service, events } = setup({
      parse: () => ({ kind: 'ignored', externalType: 'x' }),
    });
    await expect(service.receive('pub', req())).resolves.toEqual({
      status: 'ignored',
    });
    expect(events.rows).toHaveLength(0);
  });

  it('stores the events of a paused connection', async () => {
    const { service, events } = setup({
      conn: connection({ state: 'paused' }),
    });
    await service.receive('pub', req());
    expect(events.rows).toHaveLength(1);
  });

  it('stores an authenticated event whose parse() throws as needs_attention and still accepts', async () => {
    const { service, events } = setup({
      parse: () => {
        throw new Error('not json');
      },
    });
    await expect(service.receive('pub', req('garbage'))).resolves.toEqual({
      status: 'accepted',
    });
    expect(events.rows[0]).toMatchObject({
      state: 'needs_attention',
      externalType: 'unparseable',
    });
  });

  it('drops an event whose environment differs from the connection', async () => {
    const { service, events } = setup({
      parse: () => ({
        kind: 'operation',
        deliveryId: 'd',
        externalType: 't',
        environment: 'live',
      }),
    });
    await expect(service.receive('pub', req())).resolves.toEqual({
      status: 'ignored',
    });
    expect(events.rows).toHaveLength(0);
  });

  it('drops an event whose externalAccountId differs from the connection', async () => {
    const { service, events } = setup({
      parse: () => ({
        kind: 'operation',
        deliveryId: 'd',
        externalType: 't',
        externalAccountId: 'other',
      }),
    });
    await expect(service.receive('pub', req())).resolves.toEqual({
      status: 'ignored',
    });
    expect(events.rows).toHaveLength(0);
  });

  it('propagates a persistence failure instead of claiming success', async () => {
    const { service, events } = setup();
    events.fail = true;
    await expect(service.receive('pub', req())).rejects.toThrow('db down');
  });

  it('never stores the raw body in clear', async () => {
    const { service, events } = setup();
    await service.receive('pub', req('{"customer":"Maria da Silva"}'));
    expect(JSON.stringify(events.rows[0])).not.toContain('Maria da Silva');
  });
});
