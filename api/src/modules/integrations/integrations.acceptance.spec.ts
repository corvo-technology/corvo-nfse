import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import type { CompanyService } from '@/modules/company/application/company.service';
import { ConnectionService } from './application/connection.service';
import { CredentialsService } from './application/credentials.service';
import { EventHandlerService } from './application/event-handler.service';
import { EventProcessorService } from './application/event-processor.service';
import { InboundReceiverService } from './application/inbound-receiver.service';
import { OperationEmitter } from './application/operation-emitter.service';
import { OperationService } from './application/operation.service';
import type { InboundRequest } from './domain/connector';
import { ConnectorRegistry } from './domain/connector-registry';
import {
  InvoiceIssuancePort,
  type IssueInvoiceCommand,
} from './domain/invoice-issuance.port';
import { IntegrationConnectionOrmEntity } from './infra/integration-connection.orm-entity';
import { IntegrationEventOrmEntity } from './infra/integration-event.orm-entity';
import { IntegrationOperationOrmEntity } from './infra/integration-operation.orm-entity';
import { IntegrationRuleOrmEntity } from './infra/integration-rule.orm-entity';
import { TypeOrmIntegrationConnectionRepository } from './infra/typeorm-integration-connection.repository';
import { TypeOrmIntegrationEventRepository } from './infra/typeorm-integration-event.repository';
import { TypeOrmIntegrationOperationRepository } from './infra/typeorm-integration-operation.repository';
import { TypeOrmIntegrationRuleRepository } from './infra/typeorm-integration-rule.repository';
import {
  syntheticFormConnector,
  syntheticJsonConnector,
} from './testing/synthetic-connectors';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);

const schema = `integ_accept_${randomUUID().replaceAll('-', '')}`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();

/** Idempotent like the real invoice path: one invoice per key, a "usage reservation" per new invoice. */
class FakeIssuance extends InvoiceIssuancePort {
  invoices = new Map<string, string>();
  reservations = 0;
  calls = 0;
  issue(command: IssueInvoiceCommand) {
    this.calls++;
    const known = this.invoices.get(command.idempotencyKey);
    if (known) return Promise.resolve({ invoiceId: known, replay: true });
    this.reservations++;
    const id = randomUUID();
    this.invoices.set(command.idempotencyKey, id);
    return Promise.resolve({ invoiceId: id, replay: false });
  }
}

const sign = (body: string, secret: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describePostgres('integrations end to end on real PostgreSQL', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  let operationService: OperationService;
  let operationsRepo: TypeOrmIntegrationOperationRepository;
  let eventsRepo: TypeOrmIntegrationEventRepository;
  const t = (name: string) => `"${schema}"."${name}"`;

  async function count(table: string): Promise<number> {
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t(table)}`,
    );
    return rows[0].n;
  }

  /** A connection of the given synthetic provider, active, with a default rule. */
  async function activeConnection(
    provider: 'synthetic-json' | 'synthetic-form',
    tenant = tenantA,
    company = companyA,
  ) {
    const account = randomUUID();
    const secret = randomBytes(8).toString('hex');
    const created = await connections.create(tenant, {
      provider,
      companyId: company,
      environment: 'test',
      credentials: { secret, account },
    });
    await connections.validate(tenant, created.id);
    await connections.replaceRules(tenant, created.id, [
      {
        externalProductId: null,
        service: { code: '010101', description: 'Servico' },
        sendEmail: false,
        allowAnonymousCustomer: false,
      },
    ]);
    const active = await connections.activate(tenant, created.id);
    return { connection: active, secret, publicId: active.publicId };
  }

  const jsonRequest = (
    body: object,
    secret: string,
    signature?: string,
  ): InboundRequest => {
    const raw = JSON.stringify(body);
    return {
      rawBody: Buffer.from(raw),
      headers: { 'x-synthetic-signature': signature ?? sign(raw, secret) },
      query: {},
    };
  };
  const formRequest = (
    fields: Record<string, string>,
    token: string,
  ): InboundRequest => ({
    rawBody: Buffer.from(new URLSearchParams(fields).toString()),
    headers: {},
    query: { token },
  });
  const paidJson = (
    id: string,
    charge: string,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    type: 'payment.paid',
    at: '2026-10-29T15:00:00Z',
    charge: {
      id: charge,
      cents: 4990,
      customer: { name: 'Maria', document: '52998224725' },
      ...over,
    },
  });

  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) if ((await processor.runOnce()) === 0) return;
  }

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const [company, tenant] of [
      [companyA, tenantA],
      [companyB, tenantB],
    ])
      await db.query(
        `INSERT INTO ${t('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'F','11222333000181','test')`,
        [company, tenant],
      );

    const registry = new ConnectorRegistry();
    registry.register(syntheticJsonConnector);
    registry.register(syntheticFormConnector);
    const cipher = new SecretsCipherService(
      new ConfigService({
        meta: { secretsEncryptionKey: randomBytes(32).toString('base64') },
      }),
    );
    const connectionRepo = new TypeOrmIntegrationConnectionRepository(
      db.getRepository(IntegrationConnectionOrmEntity),
    );
    eventsRepo = new TypeOrmIntegrationEventRepository(
      db.getRepository(IntegrationEventOrmEntity),
    );
    operationsRepo = new TypeOrmIntegrationOperationRepository(
      db.getRepository(IntegrationOperationOrmEntity),
    );
    const rules = new TypeOrmIntegrationRuleRepository(
      db.getRepository(IntegrationRuleOrmEntity),
    );
    issuance = new FakeIssuance();
    const companies = {
      findById: () => Promise.resolve({}),
    } as unknown as CompanyService;
    connections = new ConnectionService(
      registry,
      connectionRepo,
      rules,
      new CredentialsService(cipher),
      companies,
    );
    receiver = new InboundReceiverService(
      registry,
      connections,
      eventsRepo,
      cipher,
    );
    const emitter = new OperationEmitter(
      connections,
      operationsRepo,
      rules,
      issuance,
    );
    operationService = new OperationService(operationsRepo, emitter);
    processor = new EventProcessorService(
      eventsRepo,
      new EventHandlerService(
        registry,
        connections,
        operationsRepo,
        emitter,
        cipher,
      ),
    );
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM ${t('integration_events')}`);
    await db.query(`DELETE FROM ${t('integration_operations')}`);
    issuance.invoices.clear();
    issuance.reservations = 0;
    issuance.calls = 0;
  });

  it('invalid signature: rejected and nothing is stored', async () => {
    const { publicId } = await activeConnection('synthetic-json');
    await expect(
      receiver.receive(
        publicId,
        jsonRequest(paidJson('e1', 'c1'), 'x', 'f'.repeat(64)),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });

  it('a paid delivery becomes one event, one operation and one invoice, on both connector shapes', async () => {
    const json = await activeConnection('synthetic-json');
    await receiver.receive(
      json.publicId,
      jsonRequest(paidJson('e1', 'c1'), json.secret),
    );
    const form = await activeConnection('synthetic-form');
    await receiver.receive(
      form.publicId,
      formRequest(
        {
          kind: 'paid',
          event_ref: 'f1',
          sale_id: 's1',
          amount: '49.90',
          when: '2026-10-29T15:00:00Z',
          buyer: 'Maria',
          cpf: '52998224725',
        },
        form.secret,
      ),
    );
    await drain();
    expect(await count('integration_events')).toBe(2);
    expect(await count('integration_operations')).toBe(2);
    expect(issuance.reservations).toBe(2);
    const rows: Array<{ fiscal_status: string; invoice_id: string | null }> =
      await db.query(
        `SELECT fiscal_status, invoice_id FROM ${t('integration_operations')}`,
      );
    expect(
      rows.every((r) => r.fiscal_status === 'submitted' && r.invoice_id),
    ).toBe(true);
  });

  it('the same event twice, sequential and parallel, leaves one event and one invoice', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    const request = () => jsonRequest(paidJson('e-dup', 'c-dup'), secret);
    await receiver.receive(publicId, request());
    await Promise.all([
      receiver.receive(publicId, request()),
      receiver.receive(publicId, request()),
    ]);
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.reservations).toBe(1);
  });

  it('different events and a resend with a new delivery id for the same charge issue one invoice', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e1', 'c-same'), secret),
    );
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e2-resend', 'c-same'), secret),
    );
    await drain();
    expect(await count('integration_events')).toBe(2);
    expect(await count('integration_operations')).toBe(1);
    expect(issuance.reservations).toBe(1);
  });

  it('a transport test delivery answers ok and stores nothing', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await expect(
      receiver.receive(
        publicId,
        jsonRequest({ id: 'p', type: 'ping' }, secret),
      ),
    ).resolves.toEqual({ status: 'test' });
    expect(await count('integration_events')).toBe(0);
  });

  it('a refund that arrives before the paid notice means no invoice', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest(
        {
          ...paidJson('e-ref', 'c-ref'),
          type: 'payment.refunded',
          at: '2026-10-29T16:00:00Z',
        },
        secret,
      ),
    );
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e-late', 'c-ref'), secret),
    );
    await drain();
    expect(issuance.calls).toBe(0);
    const rows: Array<{ commercial_state: string; fiscal_status: string }> =
      await db.query(
        `SELECT commercial_state, fiscal_status FROM ${t('integration_operations')}`,
      );
    expect(rows).toEqual([
      { commercial_state: 'refunded', fiscal_status: 'blocked' },
    ]);
  });

  it('a masked customer waits for attention; completing it and retrying issues the invoice', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest(
        paidJson('e-m', 'c-m', {
          customer: { name: 'Maria', document: '529.***.***-25' },
        }),
        secret,
      ),
    );
    await drain();
    expect(issuance.calls).toBe(0);
    const opRows: Array<{ id: string; block_reason: string }> = await db.query(
      `SELECT id, block_reason FROM ${t('integration_operations')}`,
    );
    const op = opRows[0];
    expect(op.block_reason).toBe('customer_tax_id_missing');
    await operationService.completeCustomer(tenantA, op.id, {
      name: 'Maria',
      taxId: '52998224725',
    });
    await expect(operationService.retry(tenantA, op.id)).resolves.toMatchObject(
      { state: 'processed' },
    );
    expect(issuance.reservations).toBe(1);
  });

  it('a paused connection records the event but does not issue; the retry after reactivating does', async () => {
    const { connection, publicId, secret } =
      await activeConnection('synthetic-json');
    await connections.pause(tenantA, connection.id);
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e-p', 'c-p'), secret),
    );
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.calls).toBe(0);
    await connections.activate(tenantA, connection.id);
    const opRows: Array<{ id: string }> = await db.query(
      `SELECT id FROM ${t('integration_operations')}`,
    );
    const op = opRows[0];
    await operationService.retry(tenantA, op.id);
    expect(issuance.reservations).toBe(1);
  });

  it('a crash after the invoice was accepted and before it was saved is recovered without a second reservation', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    const spy = jest
      .spyOn(operationsRepo, 'setFiscal')
      .mockRejectedValueOnce(new Error('crash'));
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e-c', 'c-c'), secret),
    );
    await drain();
    spy.mockRestore();
    expect(issuance.reservations).toBe(1);
    const eventRows: Array<{ state: string; attempts: number }> =
      await db.query(`SELECT state, attempts FROM ${t('integration_events')}`);
    const event = eventRows[0];
    expect(event.state).toBe('retry_pending');
    await db.query(
      `UPDATE ${t('integration_events')} SET next_attempt_at = now()`,
    );
    await drain();
    expect(issuance.reservations).toBe(1);
    expect(issuance.calls).toBe(2);
    const opRows: Array<{ fiscal_status: string; invoice_id: string | null }> =
      await db.query(
        `SELECT fiscal_status, invoice_id FROM ${t('integration_operations')}`,
      );
    const op = opRows[0];
    expect(op).toMatchObject({ fiscal_status: 'submitted' });
    expect(op.invoice_id).toBeTruthy();
  });

  it('an event from another environment is dropped and never issues', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest({ ...paidJson('e-live', 'c-live'), livemode: true }, secret),
    );
    await drain();
    expect(await count('integration_events')).toBe(0);
    expect(issuance.calls).toBe(0);
  });

  it('an authenticated body that cannot be read is kept for diagnosis and answered normally', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    const raw = 'not json at all';
    await expect(
      receiver.receive(publicId, {
        rawBody: Buffer.from(raw),
        headers: { 'x-synthetic-signature': sign(raw, secret) },
        query: {},
      }),
    ).resolves.toEqual({ status: 'accepted' });
    const rows: Array<{ state: string }> = await db.query(
      `SELECT state FROM ${t('integration_events')}`,
    );
    expect(rows).toEqual([{ state: 'needs_attention' }]);
  });

  it('events are encrypted at rest', async () => {
    const { publicId, secret } = await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest(
        paidJson('e-enc', 'c-enc', {
          customer: { name: 'Nome Secreto', document: '52998224725' },
        }),
        secret,
      ),
    );
    const rows: Array<{ payload_enc: string }> = await db.query(
      `SELECT payload_enc FROM ${t('integration_events')}`,
    );
    expect(rows[0].payload_enc).not.toContain('Nome Secreto');
    const credentials: Array<{ credentials_enc: string }> = await db.query(
      `SELECT credentials_enc FROM ${t('integration_connections')} LIMIT 1`,
    );
    expect(credentials[0].credentials_enc).not.toContain(secret);
  });

  it('another tenant cannot see the connection, its events or its operations', async () => {
    const { connection, publicId, secret } =
      await activeConnection('synthetic-json');
    await receiver.receive(
      publicId,
      jsonRequest(paidJson('e-iso', 'c-iso'), secret),
    );
    await drain();
    await expect(connections.get(tenantB, connection.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      eventsRepo.listByConnection(connection.id, tenantB, 10),
    ).resolves.toEqual([]);
    await expect(
      operationService.list(tenantB, connection.id, 10),
    ).resolves.toEqual([]);
    const opRows: Array<{ id: string }> = await db.query(
      `SELECT id FROM ${t('integration_operations')}`,
    );
    const op = opRows[0];
    await expect(operationService.retry(tenantB, op.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
