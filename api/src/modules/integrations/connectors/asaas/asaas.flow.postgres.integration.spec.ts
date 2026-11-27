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
import { AsaasConnector } from './asaas.connector';
import type { AsaasClient, AsaasCustomer } from './asaas.client';

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

const schema = `integ_asaas_${randomUUID().replaceAll('-', '')}`;
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

/** What Asaas's customer API answers; the same buyer unless a test changes it. */
const lookup: AsaasCustomer = {
  name: 'John Doe',
  email: 'john.doe@asaas.com.br',
  cpfCnpj: '529.982.247-25',
  address: { street: 'Av. Paulista, 150', city: 'São Paulo', state: 'SP' },
};
const client = {
  getCustomer: jest.fn(() => Promise.resolve(lookup)),
  checkCredentials: jest.fn(() => Promise.resolve()),
} as unknown as AsaasClient;

describePostgres('Asaas connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  /** The token the client would copy from the create response and paste into Asaas. */
  async function activeConnection(
    allowAnonymousCustomer = true,
    cancelOnRefund = false,
    credentials: Record<string, string> = { access_token: 'fake_key' },
  ) {
    const created = await connections.create(tenant, {
      provider: 'asaas',
      companyId: company,
      environment: 'live',
      credentials,
    });
    const { webhookToken } = connections.toView(created).credentials;
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
    return { publicId: active.publicId, webhookToken };
  }
  const delivery = (
    body: string,
    auth: { webhookToken: string },
    over: { token?: string } = {},
  ) => ({
    rawBody: Buffer.from(body),
    headers: { 'asaas-access-token': over.token ?? auth.webhookToken },
    query: {},
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
    registry.register(new AsaasConnector(client));
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

  it('creating a connection generates the webhook token, long enough for Asaas (32+ characters)', async () => {
    const { webhookToken } = await activeConnection();
    expect(webhookToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('a received Pix issues one invoice with the customer looked up', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(
        auth.publicId,
        delivery(fixture('payment-received-pix'), auth),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 49.9,
      service: { code: '010101' },
      customer: {
        name: 'John Doe',
        taxId: '52998224725',
        address: { city: 'São Paulo', state: 'SP' },
      },
      externalId: 'asaas:pay_7710000000001',
    });
  });

  it('the confirmed and the received event of the same charge issue one invoice', async () => {
    const auth = await activeConnection();
    const confirmed = fixture('payment-confirmed-boleto');
    const received = JSON.stringify({
      ...(JSON.parse(confirmed) as object),
      id: 'evt_boleto2&9',
      event: 'PAYMENT_RECEIVED',
    });
    await receiver.receive(auth.publicId, delivery(confirmed, auth));
    await receiver.receive(auth.publicId, delivery(received, auth));
    await drain();
    expect(await count('integration_events')).toBe(2);
    expect(issuance.invoices.size).toBe(1);
    expect(await count('integration_operations')).toBe(1);
  });

  it('Asaas retrying the same delivery does not issue twice', async () => {
    const auth = await activeConnection();
    const body = fixture('payment-received');
    await Promise.all([
      receiver.receive(auth.publicId, delivery(body, auth)),
      receiver.receive(auth.publicId, delivery(body, auth)),
    ]);
    await receiver.receive(auth.publicId, delivery(body, auth));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('without an API key the sale has no document and waits as pending when anonymous sales are not allowed', async () => {
    const auth = await activeConnection(false, false, {});
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-received'), auth),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    const rows: Array<{ fiscal_state: string }> = await db.query(
      `SELECT fiscal_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal_state).not.toBe('issued');
  });

  it('with "cancel on refund" on, a refund after the invoice asks for that invoice to be cancelled, once', async () => {
    const auth = await activeConnection(true, true);
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-received'), auth),
    );
    await drain();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-refunded'), auth),
    );
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-refunded'), auth),
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

  it('a refund after the invoice, with the option off, only flags it', async () => {
    const auth = await activeConnection();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-received'), auth),
    );
    await drain();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-refunded'), auth),
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

  it('a chargeback after the invoice is flagged and never cancels the invoice by itself', async () => {
    const auth = await activeConnection(true, true);
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-received'), auth),
    );
    await drain();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-chargeback-requested'), auth),
    );
    await drain();
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ commercial_state: string }> = await db.query(
      `SELECT commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toEqual([{ commercial_state: 'disputed' }]);
  });

  it('a refund of a charge that was never paid is ignored and creates no sale', async () => {
    const auth = await activeConnection();
    await receiver.receive(
      auth.publicId,
      delivery(fixture('payment-refunded'), auth),
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

  it('an overdue charge is acknowledged and not stored', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(
        auth.publicId,
        delivery(fixture('payment-overdue'), auth),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });

  it('a wrong or missing token is rejected and nothing is stored', async () => {
    const auth = await activeConnection();
    await expect(
      receiver.receive(
        auth.publicId,
        delivery(fixture('payment-received'), auth, { token: 'wrong' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(auth.publicId, {
        rawBody: Buffer.from(fixture('payment-received')),
        headers: {},
        query: {},
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });
});
