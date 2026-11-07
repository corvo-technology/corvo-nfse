import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
import { AbacatePayConnector } from './abacatepay.connector';
import type { AbacatePayClient } from './abacatepay.client';

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

const schema = `integ_abacate_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
// A key made for this run: the connector and the signature in the test only need to agree with each other.
const HMAC_KEY = randomBytes(24).toString('hex');
const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');

/** What AbacatePay's customer API answers; no document by default. */
let lookup: {
  name: string | null;
  email: string | null;
  taxId: string | null;
} = { name: null, email: null, taxId: null };

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

describePostgres('AbacatePay connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  /** The URL secret the client would copy from the create response. */
  async function activeConnection(
    environment: 'test' | 'live' = 'live',
    allowAnonymousCustomer = true,
    cancelOnRefund = false,
  ) {
    const created = await connections.create(tenant, {
      provider: 'abacatepay',
      companyId: company,
      environment,
      credentials: { apiKey: 'abc_key' },
    });
    const { webhookSecret } = connections.toView(created).credentials;
    await connections.validate(tenant, created.id);
    await connections.replaceRules(tenant, created.id, [
      {
        externalProductId: null,
        service: { code: '010101' },
        sendEmail: false,
        allowAnonymousCustomer,
        cancelOnRefund,
      },
      {
        externalProductId: 'prod_consultoria',
        service: { code: '020202', description: 'Consultoria' },
        sendEmail: true,
        allowAnonymousCustomer,
        cancelOnRefund,
      },
    ]);
    const active = await connections.activate(tenant, created.id);
    return { publicId: active.publicId, webhookSecret };
  }
  const delivery = (
    body: string,
    webhookSecret: string,
    over: { signature?: string } = {},
  ) => ({
    rawBody: Buffer.from(body),
    headers: {
      'x-webhook-signature':
        over.signature ??
        createHmac('sha256', HMAC_KEY).update(body).digest('base64'),
    },
    query: { webhookSecret },
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
    registry.register(
      new AbacatePayConnector(HMAC_KEY, {
        checkCredentials: () => Promise.resolve(),
        getCustomer: () => Promise.resolve(lookup),
        getProductName: () => Promise.resolve('Plano Pro'),
      } as unknown as AbacatePayClient),
    );
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
    lookup = { name: null, email: null, taxId: null };
  });

  it('creating a connection needs only the API key: the webhook secret is generated', async () => {
    const { webhookSecret } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('a completed checkout issues one invoice with the rule of its product and no customer when the document is masked', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('checkout-completed'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    const request = issuance.commands[0].request;
    expect(request).toMatchObject({
      amount: 100,
      competenceDate: '2026-10-29',
      email: true,
      service: { code: '020202' },
      externalId: 'checkout:bill_abc123xyz',
    });
    // The product rule sets its own description, which wins over the product name.
    expect(request.service).toMatchObject({ description: 'Consultoria' });
    expect(request).not.toHaveProperty('customer');
  });

  it('a masked document is completed from the customer API and the invoice goes out with the customer', async () => {
    lookup = {
      name: 'Maria da Silva',
      email: 'maria@example.com',
      taxId: '52998224725',
    };
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-completed'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      customer: { taxId: '52998224725' },
    });
  });

  it('without allowAnonymousCustomer the masked document waits for the customer to be completed', async () => {
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-completed'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    expect(rows[0].block_reason).toBe('customer_tax_id_missing');
  });

  it('AbacatePay retrying the same delivery does not issue twice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = fixture('checkout-completed');
    await Promise.all([
      receiver.receive(publicId, delivery(body, webhookSecret)),
      receiver.receive(publicId, delivery(body, webhookSecret)),
    ]);
    await receiver.receive(publicId, delivery(body, webhookSecret));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('with "cancel on refund" on, a refund after the invoice asks for that invoice to be cancelled, once', async () => {
    const { publicId, webhookSecret } = await activeConnection(
      'live',
      true,
      true,
    );
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-completed'), webhookSecret),
    );
    await drain();
    const refunded = fixture('checkout-refunded');
    await receiver.receive(publicId, delivery(refunded, webhookSecret));
    // AbacatePay may send the refund again under another id.
    await receiver.receive(
      publicId,
      delivery(refunded.replace('log_ref1', 'log_ref2'), webhookSecret),
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
    const rows: Array<{ fiscal_status: string; block_reason: string }> =
      await db.query(
        `SELECT fiscal_status, block_reason FROM ${t('integration_operations')}`,
      );
    expect(rows).toEqual([
      { fiscal_status: 'submitted', block_reason: 'cancel_requested' },
    ]);
  });

  it('a refund after the invoice leaves the invoice alone and flags it', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-completed'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-refunded'), webhookSecret),
    );
    await drain();
    expect(issuance.invoices.size).toBe(1);
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{
      fiscal_status: string;
      block_reason: string;
      commercial_state: string;
    }> = await db.query(
      `SELECT fiscal_status, block_reason, commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toEqual([
      {
        fiscal_status: 'submitted',
        block_reason: 'refund_after_invoice',
        commercial_state: 'refunded',
      },
    ]);
  });

  it('a refund that arrives first blocks the later paid notice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-refunded'), webhookSecret),
    );
    await receiver.receive(
      publicId,
      delivery(fixture('checkout-completed'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
  });

  it('a wrong secret or a wrong signature is rejected and nothing is stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('checkout-completed'), 'wrong'),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('checkout-completed'), webhookSecret, {
          signature: 'AAAA',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });

  it('a dev-mode event on a live connection is dropped and never issues', async () => {
    const { publicId, webhookSecret } = await activeConnection('live');
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('transparent-completed'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    await drain();
    expect(await count('integration_events')).toBe(0);
    expect(issuance.commands).toHaveLength(0);
  });

  it('a dev-mode transparent payment on a test connection issues', async () => {
    const { publicId, webhookSecret } = await activeConnection('test');
    await receiver.receive(
      publicId,
      delivery(fixture('transparent-completed'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 25,
      customer: { taxId: '52998224725' },
      service: { code: '010101' },
    });
  });

  it('events the connector does not handle are acknowledged and not stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = JSON.stringify({
      id: 'x',
      event: 'transfer.completed',
      apiVersion: 2,
      devMode: false,
      data: {},
    });
    await expect(
      receiver.receive(publicId, delivery(body, webhookSecret)),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });
});
