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
import { FakeCancellation } from '../../testing/fake-cancellation';
import { KiwifyConnector } from './kiwify.connector';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);

const schema = `integ_kiwify_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
// A token made for this run: the connector and the signature in the test only need to agree.
const TOKEN = randomBytes(16).toString('hex');

type Body = Record<string, unknown> & {
  Customer?: Record<string, unknown>;
  Commissions?: Record<string, unknown>;
};
const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const changed = (name: string, change: (body: Body) => void) => {
  const body = JSON.parse(fixture(name)) as Body;
  change(body);
  return JSON.stringify(body);
};

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

describePostgres('Kiwify connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  async function activeConnection(
    options: {
      environment?: 'test' | 'live';
      allowAnonymousCustomer?: boolean;
      cancelOnRefund?: boolean;
      invoiceValue?: string;
    } = {},
  ) {
    const {
      environment = 'live',
      allowAnonymousCustomer = false,
      cancelOnRefund = false,
      invoiceValue,
    } = options;
    const created = await connections.create(tenant, {
      provider: 'kiwify',
      companyId: company,
      environment,
      credentials: { token: TOKEN, ...(invoiceValue ? { invoiceValue } : {}) },
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
    ]);
    const active = await connections.activate(tenant, created.id);
    return { publicId: active.publicId, webhookSecret };
  }
  /** What Kiwify sends: the body signed with the token, the signature in the query. */
  const delivery = (
    body: string,
    webhookSecret: string,
    over: { signature?: string } = {},
  ) => ({
    rawBody: Buffer.from(body),
    headers: {},
    query: {
      webhookSecret,
      signature:
        over.signature ?? createHmac('sha1', TOKEN).update(body).digest('hex'),
    },
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
  const blockReason = async () => {
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    return rows[0]?.block_reason;
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
    registry.register(new KiwifyConnector());
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

  it('creating a connection needs only the token: the URL secret is generated and invoiceValue is optional', async () => {
    const { webhookSecret } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const rows: Array<{ external_account_id: string }> = await db.query(
      `SELECT external_account_id FROM ${t('integration_connections')} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0].external_account_id).toMatch(/^kiwify:[0-9a-f]{24}$/);
  });

  it('an unknown invoiceValue is refused when the connection is created', async () => {
    await expect(
      connections.create(tenant, {
        provider: 'kiwify',
        companyId: company,
        environment: 'live',
        credentials: { token: TOKEN, invoiceValue: 'half' },
      }),
    ).rejects.toThrow(/Invalid value/);
  });

  it('an approved order issues one invoice for the total paid, with the buyer from the payload', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('order-approved'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 100,
      competenceDate: '2026-10-29',
      email: false,
      service: { code: '010101', description: 'Curso de Excel' },
      customer: { taxId: '52998224725', name: 'Maria da Silva' },
      externalId: 'kiwify:9b1c2d3e-0000-4000-8000-000000000001',
    });
  });

  it('"minha parte" issues the producer share instead of the total', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      invoiceValue: 'mine',
    });
    await receiver.receive(
      publicId,
      delivery(fixture('order-approved'), webhookSecret),
    );
    await drain();
    expect(issuance.commands[0].request).toMatchObject({ amount: 80 });
  });

  it('"minha parte" without the share in the payload issues nothing and asks for attention', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      invoiceValue: 'mine',
    });
    await receiver.receive(
      publicId,
      delivery(
        changed('order-approved', (b) => delete b.Commissions!.my_commission),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    const rows: Array<{ state: string }> = await db.query(
      `SELECT state FROM ${t('integration_events')}`,
    );
    expect(rows).toEqual([{ state: 'needs_attention' }]);
  });

  it('a buyer without a usable document waits for the customer data to be completed', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(
        changed('order-approved', (b) => (b.Customer!.country = 'PT')),
        webhookSecret,
      ),
    );
    await receiver.receive(
      publicId,
      delivery(
        changed('order-approved', (b) => {
          b.order_id = 'other-order';
          delete b.Customer!.CPF;
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    expect(rows.map((r) => r.block_reason)).toEqual([
      'customer_tax_id_missing',
      'customer_tax_id_missing',
    ]);
  });

  it('an order in another currency is blocked with unsupported_currency', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(
        changed('order-approved', (b) => (b.Commissions!.currency = 'USD')),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('unsupported_currency');
  });

  it('Kiwify retrying the same delivery does not issue twice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = fixture('order-approved');
    await Promise.all([
      receiver.receive(publicId, delivery(body, webhookSecret)),
      receiver.receive(publicId, delivery(body, webhookSecret)),
    ]);
    await receiver.receive(publicId, delivery(body, webhookSecret));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('a subscription renewal (new order id) issues its own invoice, and subscription_renewed adds nothing', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(fixture('order-approved'), webhookSecret),
    );
    await receiver.receive(
      publicId,
      delivery(fixture('subscription-order-approved'), webhookSecret),
    );
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('subscription-renewed'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    await drain();
    expect(issuance.invoices.size).toBe(2);
    expect(await count('integration_operations')).toBe(2);
  });

  it('with "cancel on refund" on, a refund after the invoice asks for that invoice to be cancelled, once', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      cancelOnRefund: true,
    });
    await receiver.receive(
      publicId,
      delivery(fixture('order-approved'), webhookSecret),
    );
    await drain();
    const refunded = fixture('order-refunded');
    await receiver.receive(publicId, delivery(refunded, webhookSecret));
    // Kiwify may resend the refund: the same delivery id stores nothing new.
    await receiver.receive(publicId, delivery(refunded, webhookSecret));
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
      delivery(fixture('order-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('order-refunded'), webhookSecret),
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
    const { publicId, webhookSecret } = await activeConnection({
      cancelOnRefund: true,
    });
    await receiver.receive(
      publicId,
      delivery(fixture('order-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('chargeback'), webhookSecret),
    );
    await drain();
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ commercial_state: string }> = await db.query(
      `SELECT commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toEqual([{ commercial_state: 'disputed' }]);
  });

  it('a refund for an order we never saw is parked as ignored, not issued', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(fixture('order-refunded'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await count('integration_operations')).toBe(0);
  });

  it('a wrong URL secret, a wrong signature, a tampered body or no signature are rejected and nothing is stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = fixture('order-approved');
    await expect(
      receiver.receive(publicId, delivery(body, 'wrong')),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(
        publicId,
        delivery(body, webhookSecret, { signature: '0'.repeat(40) }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    const tampered = delivery(body, webhookSecret);
    tampered.rawBody = Buffer.from(body.replace('15:00', '16:00'));
    await expect(receiver.receive(publicId, tampered)).rejects.toThrow(
      UnauthorizedException,
    );
    const unsigned = delivery(body, webhookSecret);
    delete (unsigned.query as Record<string, unknown>).signature;
    await expect(receiver.receive(publicId, unsigned)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(await count('integration_events')).toBe(0);
  });

  it("subscription events, sales that are not the producer's and the transport test are acknowledged and not stored", async () => {
    const { publicId, webhookSecret } = await activeConnection();
    for (const body of [
      changed(
        'subscription-renewed',
        (b) => (b.webhook_event_type = 'subscription_canceled'),
      ),
      changed('order-approved', (b) => (b.sale_type = 'affiliate')),
    ])
      await expect(
        receiver.receive(publicId, delivery(body, webhookSecret)),
      ).resolves.toEqual({ status: 'ignored' });
    await expect(
      receiver.receive(publicId, delivery('{}', webhookSecret)),
    ).resolves.toEqual({ status: 'test' });
    expect(await count('integration_events')).toBe(0);
  });

  it('a connection in the test environment issues on test data', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      environment: 'test',
    });
    await receiver.receive(
      publicId,
      delivery(fixture('order-approved'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
  });
});
