import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import type { CompanyService } from '@/modules/company/application/company.service';
import { ConnectionService } from '../../application/connection.service';
import { CredentialsService } from '../../application/credentials.service';
import { EventHandlerService } from '../../application/event-handler.service';
import { EventProcessorService } from '../../application/event-processor.service';
import { InboundReceiverService } from '../../application/inbound-receiver.service';
import { OperationEmitter } from '../../application/operation-emitter.service';
import { ConnectorRegistry } from '../../domain/connector-registry';
import {
  InvoiceIssuancePort,
  type IssueInvoiceCommand,
} from '../../domain/invoice-issuance.port';
import { IntegrationConnectionOrmEntity } from '../../infra/integration-connection.orm-entity';
import { IntegrationEventOrmEntity } from '../../infra/integration-event.orm-entity';
import { IntegrationOperationOrmEntity } from '../../infra/integration-operation.orm-entity';
import { IntegrationRuleOrmEntity } from '../../infra/integration-rule.orm-entity';
import { TypeOrmIntegrationConnectionRepository } from '../../infra/typeorm-integration-connection.repository';
import { TypeOrmIntegrationEventRepository } from '../../infra/typeorm-integration-event.repository';
import { TypeOrmIntegrationOperationRepository } from '../../infra/typeorm-integration-operation.repository';
import { TypeOrmIntegrationRuleRepository } from '../../infra/typeorm-integration-rule.repository';
import { PushinPayConnector } from './pushinpay.connector';

import { FakeCancellation } from '../../testing/fake-cancellation';
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);

const schema = `integ_pushin_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');

const cancellation = new FakeCancellation();

class FakeIssuance extends InvoiceIssuancePort {
  invoices = new Map<string, string>();
  commands: IssueInvoiceCommand[] = [];
  issue(command: IssueInvoiceCommand) {
    this.commands.push(command);
    const known = this.invoices.get(command.idempotencyKey);
    if (known) return Promise.resolve({ invoiceId: known, replay: true });
    const id = randomUUID();
    this.invoices.set(command.idempotencyKey, id);
    return Promise.resolve({ invoiceId: id, replay: false });
  }
}

describePostgres('PushinPay connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  /** The secret and the header token the client would copy from the create response. */
  async function activeConnection(
    allowAnonymousCustomer = true,
    cancelOnRefund = false,
  ) {
    const created = await connections.create(tenant, {
      provider: 'pushinpay',
      companyId: company,
      environment: 'live',
      credentials: {},
    });
    const { webhookSecret, webhookToken } =
      connections.toView(created).credentials;
    await connections.validate(tenant, created.id);
    await connections.replaceRules(tenant, created.id, [
      {
        externalProductId: null,
        service: { code: '010101' },
        sendEmail: false,
        allowAnonymousCustomer,
        cancelOnRefund,
      },
    ]);
    const active = await connections.activate(tenant, created.id);
    return { publicId: active.publicId, webhookSecret, webhookToken };
  }
  const delivery = (
    body: string,
    auth: { webhookSecret: string; webhookToken: string },
    over: { token?: string } = {},
  ) => ({
    rawBody: Buffer.from(body),
    headers: { 'x-corvo-token': over.token ?? auth.webhookToken },
    query: { webhookSecret: auth.webhookSecret },
  });
  const drain = async () => {
    for (let i = 0; i < 5; i++) if ((await processor.runOnce()) === 0) return;
  };
  const count = async (table: string) => {
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t(table)}`,
    );
    return rows[0].n;
  };

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1)`, [tenant]);
    await db.query(
      `INSERT INTO ${t('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'F','11222333000181','test')`,
      [company, tenant],
    );
    const registry = new ConnectorRegistry();
    registry.register(new PushinPayConnector());
    const cipher = new SecretsCipherService(
      new ConfigService({
        meta: { secretsEncryptionKey: randomBytes(32).toString('base64') },
      }),
    );
    const connectionRepo = new TypeOrmIntegrationConnectionRepository(
      db.getRepository(IntegrationConnectionOrmEntity),
    );
    const events = new TypeOrmIntegrationEventRepository(
      db.getRepository(IntegrationEventOrmEntity),
    );
    const operations = new TypeOrmIntegrationOperationRepository(
      db.getRepository(IntegrationOperationOrmEntity),
    );
    const rules = new TypeOrmIntegrationRuleRepository(
      db.getRepository(IntegrationRuleOrmEntity),
    );
    issuance = new FakeIssuance();
    connections = new ConnectionService(
      registry,
      connectionRepo,
      rules,
      new CredentialsService(cipher),
      {
        findById: () => Promise.resolve({}),
        ensureReady: () => Promise.resolve({}),
      } as unknown as CompanyService,
    );
    receiver = new InboundReceiverService(
      registry,
      connections,
      events,
      cipher,
    );
    const emitter = new OperationEmitter(
      connections,
      operations,
      rules,
      issuance,
      events,
      cancellation,
    );
    processor = new EventProcessorService(
      events,
      new EventHandlerService(
        registry,
        connections,
        operations,
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
    issuance.commands = [];
    cancellation.calls = [];
  });

  it('creating a connection needs no credential: the secret and the header token are generated', async () => {
    const { webhookSecret, webhookToken } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(webhookToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('a paid Pix issues one invoice with the payer as customer', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(auth.publicId, delivery(fixture('pix-paid'), auth)),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 25,
      service: { code: '010101' },
      customer: { taxId: '52998224725' },
      externalId: 'pushinpay:9c8a1f4e-2b7d-4c6a-9e11-3f5a7d2b8c10',
    });
  });

  it('a recurring installment issues its own invoice', async () => {
    const auth = await activeConnection();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('recurring-installment-paid'), auth),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({ amount: 49.9 });
  });

  it('PushinPay retrying the same delivery does not issue twice', async () => {
    const auth = await activeConnection();
    const body = fixture('pix-paid');
    await Promise.all([
      receiver.receive(auth.publicId, delivery(body, auth)),
      receiver.receive(auth.publicId, delivery(body, auth)),
    ]);
    await receiver.receive(auth.publicId, delivery(body, auth));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('with "cancel on refund" on, a cancellation after the invoice asks for that invoice to be cancelled, once', async () => {
    const auth = await activeConnection(true, true);
    await receiver.receive(auth.publicId, delivery(fixture('pix-paid'), auth));
    await drain();
    // PushinPay retries up to 3 times: the same delivery id is stored once.
    await receiver.receive(
      auth.publicId,
      delivery(fixture('pix-canceled'), auth),
    );
    await receiver.receive(
      auth.publicId,
      delivery(fixture('pix-canceled'), auth),
    );
    await drain();
    const [invoiceId] = [...issuance.invoices.values()];
    expect(cancellation.calls).toEqual([
      {
        tenantId: tenant,
        environment: 'live',
        invoiceId,
        description: 'Cancelado por reembolso',
      },
    ]);
  });

  it('a cancellation after the invoice, with the option off, only flags it', async () => {
    const auth = await activeConnection();
    await receiver.receive(auth.publicId, delivery(fixture('pix-paid'), auth));
    await drain();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('pix-canceled'), auth),
    );
    await drain();
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ block_reason: string; commercial_state: string }> =
      await db.query(
        `SELECT block_reason, commercial_state FROM ${t('integration_operations')}`,
      );
    expect(rows).toEqual([
      { block_reason: 'refund_after_invoice', commercial_state: 'refunded' },
    ]);
  });

  it('a cancellation of a charge that was never paid is ignored and creates no sale', async () => {
    const auth = await activeConnection();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('pix-canceled'), auth),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await count('integration_operations')).toBe(0);
    const rows: Array<{ state: string; last_error: string }> = await db.query(
      `SELECT state, last_error FROM ${t('integration_events')}`,
    );
    expect(rows).toEqual([
      { state: 'ignored', last_error: 'refund_sale_not_found' },
    ]);
  });

  it('a created charge is acknowledged and not stored', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(auth.publicId, delivery(fixture('pix-created'), auth)),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });

  it('a wrong secret or a wrong header token is rejected and nothing is stored', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(
        auth.publicId,
        delivery(fixture('pix-paid'), { ...auth, webhookSecret: 'wrong' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(
        auth.publicId,
        delivery(fixture('pix-paid'), auth, { token: 'wrong' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });
});
