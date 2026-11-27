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
import { MercadoPagoConnector } from './mercadopago.connector';
import type { MercadoPagoClient } from './mercadopago.client';

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

const schema = `integ_mercadopago_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
// A secret made for this run: the connector and the signature in the test only need to agree with each other.
const SIGNING = randomBytes(24).toString('hex');

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const paymentFixture = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name)) as Record<string, unknown>;

/** What Mercado Pago answers for GET /v1/payments/{id}. */
let payment: Record<string, unknown> = paymentFixture('payment-approved');

/** Mercado Pago names each account once per connection, so every connection of a test gets its own. */
let account = '1';
let accounts = 0;

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

describePostgres('Mercado Pago connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  async function activeConnection(
    environment: 'test' | 'live' = 'live',
    allowAnonymousCustomer = true,
    cancelOnRefund = false,
  ) {
    account = String(44000 + ++accounts);
    const created = await connections.create(tenant, {
      provider: 'mercadopago',
      companyId: company,
      environment,
      credentials: {
        accessToken: 'APP_USR-fake-token',
        webhookSigningSecret: SIGNING,
      },
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

  /** A signed notice: the signature covers the payment id, the request id and the timestamp. */
  let requests = 0;
  const notice = (
    webhookSecret: string,
    over: {
      body?: string;
      userId?: string;
      signature?: string;
      dataId?: string;
    } = {},
  ) => {
    const body =
      over.body ??
      JSON.stringify({
        ...(JSON.parse(fixture('notification-payment-updated')) as object),
        user_id: Number(over.userId ?? account),
      });
    const dataId = over.dataId ?? '999999999';
    const requestId = `req-${++requests}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac('sha256', SIGNING)
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    return {
      rawBody: Buffer.from(body),
      headers: {
        'x-signature': over.signature ?? `ts=${ts},v1=${v1}`,
        'x-request-id': requestId,
      },
      query: { webhookSecret, 'data.id': dataId },
    };
  };
  const drain = async () => {
    for (let i = 0; i < 5; i++) if ((await processor.runOnce()) === 0) return;
  };
  const count = async (table: string) => {
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t(table)}`,
    );
    return rows[0].n;
  };
  const blockReason = async () => {
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    return rows[0]?.block_reason;
  };
  /** A later notice of the same payment: Mercado Pago sends a new id and date for each update. */
  const update = (n: number) =>
    JSON.stringify({
      ...(JSON.parse(fixture('notification-payment-updated')) as object),
      id: 20000 + n,
      date_created: `2026-11-2${n}T10:00:00.000-03:00`,
      user_id: Number(account),
    });

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
      new MercadoPagoConnector({
        getUserId: () => Promise.resolve(account),
        getPayment: () => Promise.resolve(payment),
      } as unknown as MercadoPagoClient),
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
    payment = paymentFixture('payment-approved');
  });

  it('creating a connection needs the token and the signing secret: the URL secret is generated and the account is the user id', async () => {
    const { webhookSecret } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const rows: Array<{ external_account_id: string }> = await db.query(
      `SELECT external_account_id FROM ${t('integration_connections')}`,
    );
    expect(rows[0].external_account_id).toBe(account);
  });

  it('an approved payment issues one invoice with the customer document and the default rule', async () => {
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await expect(
      receiver.receive(publicId, notice(webhookSecret)),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 200,
      competenceDate: '2026-11-20',
      email: false,
      service: { code: '010101' },
      customer: { taxId: '52998224725' },
      externalId: 'mercadopago:999999999',
    });
  });

  it('the product of the item picks its rule', async () => {
    payment = {
      ...paymentFixture('payment-approved'),
      additional_info: {
        items: [
          { id: 'prod_consultoria', title: 'Consultoria', quantity: '1' },
        ],
      },
    };
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(publicId, notice(webhookSecret));
    await drain();
    expect(issuance.commands[0].request).toMatchObject({
      service: { code: '020202', description: 'Consultoria' },
    });
  });

  it('a payment without a document waits for the customer to be completed', async () => {
    payment = paymentFixture('payment-approved-no-payer');
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(publicId, notice(webhookSecret));
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('customer_tax_id_missing');
  });

  it('a payment without a document but with a rule that allows it issues without a customer', async () => {
    payment = paymentFixture('payment-approved-no-payer');
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(publicId, notice(webhookSecret));
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).not.toHaveProperty('customer');
  });

  it('a payer with a document but no e-mail still gets the invoice, just not e-mailed', async () => {
    payment = {
      ...paymentFixture('payment-approved'),
      payer: { identification: { type: 'CPF', number: '52998224725' } },
    };
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(publicId, notice(webhookSecret));
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({ email: false });
  });

  it('a pending payment does not issue, and paying it later does', async () => {
    payment = paymentFixture('payment-pending');
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(1) }),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('not_paid');
    payment = { ...paymentFixture('payment-approved'), id: 999999999 };
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
  });

  it('a payment in another currency is blocked with unsupported_currency', async () => {
    payment = { ...paymentFixture('payment-approved'), currency_id: 'ARS' };
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(publicId, notice(webhookSecret));
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('unsupported_currency');
  });

  it('Mercado Pago retrying the same notice does not issue twice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = update(1);
    await Promise.all([
      receiver.receive(publicId, notice(webhookSecret, { body })),
      receiver.receive(publicId, notice(webhookSecret, { body })),
    ]);
    await receiver.receive(publicId, notice(webhookSecret, { body }));
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await drain();
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
      notice(webhookSecret, { body: update(1) }),
    );
    await drain();
    payment = paymentFixture('payment-refunded');
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(3) }),
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
    expect(await blockReason()).toBe('cancel_requested');
  });

  it('without the option, a refund after the invoice leaves the invoice alone and flags it', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(1) }),
    );
    await drain();
    payment = paymentFixture('payment-refunded');
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await drain();
    expect(issuance.invoices.size).toBe(1);
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ block_reason: string; commercial_state: string }> =
      await db.query(
        `SELECT block_reason, commercial_state FROM ${t('integration_operations')}`,
      );
    expect(rows).toEqual([
      { block_reason: 'refund_after_invoice', commercial_state: 'refunded' },
    ]);
  });

  it('a chargeback after the invoice only flags it, even with "cancel on refund" on', async () => {
    const { publicId, webhookSecret } = await activeConnection(
      'live',
      true,
      true,
    );
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(1) }),
    );
    await drain();
    payment = paymentFixture('payment-charged-back');
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await drain();
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ commercial_state: string }> = await db.query(
      `SELECT commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toEqual([{ commercial_state: 'disputed' }]);
  });

  it('a refund that arrives first blocks the later paid notice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    payment = paymentFixture('payment-refunded');
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(1) }),
    );
    await drain();
    payment = paymentFixture('payment-approved');
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: update(2) }),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
  });

  it('a wrong URL secret or a wrong signature is rejected and nothing is stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(receiver.receive(publicId, notice('wrong'))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      receiver.receive(
        publicId,
        notice(webhookSecret, { signature: `ts=1,v1=${'0'.repeat(64)}` }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });

  it('a test-mode notice on a live connection is dropped and never issues', async () => {
    const { publicId, webhookSecret } = await activeConnection('live');
    const body = JSON.stringify({
      ...(JSON.parse(fixture('notification-payment-updated')) as object),
      live_mode: false,
      user_id: Number(account),
    });
    await expect(
      receiver.receive(publicId, notice(webhookSecret, { body })),
    ).resolves.toEqual({ status: 'ignored' });
    await drain();
    expect(await count('integration_events')).toBe(0);
    expect(issuance.commands).toHaveLength(0);
  });

  it('a notice from another seller account is dropped', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(publicId, notice(webhookSecret, { userId: '1' })),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });

  it('other topics and the panel simulation are acknowledged and not stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        notice(webhookSecret, {
          body: fixture('notification-other-topic'),
          dataId: '555',
        }),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    const simulation = JSON.stringify({
      type: 'payment',
      live_mode: false,
      action: 'payment.updated',
      data: { id: '123456' },
    });
    await receiver.receive(
      publicId,
      notice(webhookSecret, { body: simulation, dataId: '123456' }),
    );
    expect(await count('integration_events')).toBe(0);
  });
});
