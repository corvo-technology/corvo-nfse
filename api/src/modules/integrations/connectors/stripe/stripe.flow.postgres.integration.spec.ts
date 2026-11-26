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
import { StripeConnector } from './stripe.connector';
import type { StripeClient } from './stripe.client';

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

const schema = `integ_stripe_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
// A secret made for this run: the connector and the signature in the test only need to agree with each other.
const SIGNING = `whsec_${randomBytes(24).toString('hex')}`;
/** The parts of a fixture event the tests change. */
interface FixtureEvent {
  id?: string;
  livemode?: boolean;
  account?: string;
  data: { object: Record<string, unknown> };
}

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');

/** What Stripe's customer API answers; no document by default. */
let lookup: {
  name: string | null;
  email: string | null;
  taxIds: Array<{ type: string; value: string }>;
} = { name: null, email: null, taxIds: [] };

/** What the Checkout Session lookup answers; the payment did not come from Checkout by default. */
let session: {
  taxIds: Array<{ type: string; value: string }>;
  lines: Array<{
    description: string | null;
    quantity: number;
    productId: string | null;
  }>;
} | null = null;

/** Stripe names each account once per connection, so every connection of a test gets its own. */
let account = 'acct_0';
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

describePostgres('Stripe connector through the real pipeline', () => {
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
    account = `acct_test_${++accounts}`;
    const created = await connections.create(tenant, {
      provider: 'stripe',
      companyId: company,
      environment,
      credentials: { apiKey: 'rk_fake_key', webhookSigningSecret: SIGNING },
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
  const now = () => Math.floor(Date.now() / 1000);
  const delivery = (
    body: string,
    webhookSecret: string,
    over: { signature?: string } = {},
  ) => {
    const stamp = now();
    const v1 = createHmac('sha256', SIGNING)
      .update(`${stamp}.${body}`)
      .digest('hex');
    return {
      rawBody: Buffer.from(body),
      headers: { 'stripe-signature': over.signature ?? `t=${stamp},v1=${v1}` },
      query: { webhookSecret },
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
      new StripeConnector({
        getAccountId: () => Promise.resolve(account),
        getCustomer: () => Promise.resolve(lookup),
        findCheckoutSession: () => Promise.resolve(session),
        getInvoiceLines: () => Promise.resolve([]),
      } as unknown as StripeClient),
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
    lookup = { name: null, email: null, taxIds: [] };
    session = null;
  });

  const blockReason = async () => {
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    return rows[0]?.block_reason;
  };
  const changed = (name: string, change: (event: FixtureEvent) => void) => {
    const event = JSON.parse(fixture(name)) as FixtureEvent;
    change(event);
    return JSON.stringify(event);
  };

  it('creating a connection needs the key and the signing secret: the URL secret is generated and the account is the acct id', async () => {
    const { webhookSecret } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const rows: Array<{ external_account_id: string }> = await db.query(
      `SELECT external_account_id FROM ${t('integration_connections')}`,
    );
    expect(rows[0].external_account_id).toBe(account);
  });

  it('a paid charge issues one invoice with the default rule, and no customer without a document', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('charge-succeeded'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    const request = issuance.commands[0].request;
    expect(request).toMatchObject({
      amount: 100,
      competenceDate: '2026-10-29',
      email: false,
      service: { code: '010101' },
      externalId: 'stripe_charge:ch_3SabcdefGHIJ',
    });
    expect(request).not.toHaveProperty('customer');
  });

  it('the product of the Checkout Session picks its rule and the customer document goes on the invoice', async () => {
    lookup = {
      name: 'Maria da Silva',
      email: 'maria@example.com',
      taxIds: [{ type: 'br_cpf', value: '529.982.247-25' }],
    };
    session = {
      taxIds: [],
      lines: [
        {
          description: 'Plano Pro',
          quantity: 1,
          productId: 'prod_consultoria',
        },
      ],
    };
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(
      publicId,
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      customer: { taxId: '52998224725' },
      service: { code: '020202', description: 'Consultoria' },
    });
  });

  it('without a document and without allowAnonymousCustomer the sale waits for the customer to be completed', async () => {
    const { publicId, webhookSecret } = await activeConnection('live', false);
    await receiver.receive(
      publicId,
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('customer_tax_id_missing');
  });

  it('a charge in another currency is blocked with unsupported_currency', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(
        changed('charge-succeeded', (e) => (e.data.object.currency = 'usd')),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('unsupported_currency');
  });

  it('Stripe retrying the same delivery does not issue twice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = fixture('charge-succeeded');
    await Promise.all([
      receiver.receive(publicId, delivery(body, webhookSecret)),
      receiver.receive(publicId, delivery(body, webhookSecret)),
    ]);
    await receiver.receive(publicId, delivery(body, webhookSecret));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('with "cancel on refund" on, a full refund after the invoice asks for that invoice to be cancelled, once', async () => {
    const { publicId, webhookSecret } = await activeConnection(
      'live',
      true,
      true,
    );
    await receiver.receive(
      publicId,
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    const refunded = fixture('charge-refunded');
    await receiver.receive(publicId, delivery(refunded, webhookSecret));
    // Stripe may send the refund again under another event id.
    await receiver.receive(
      publicId,
      delivery(
        refunded.replace('evt_1RefundedBBB', 'evt_1RefundedDDD'),
        webhookSecret,
      ),
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
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('charge-refunded'), webhookSecret),
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

  it('a dispute after the invoice only flags it, even with "cancel on refund" on', async () => {
    const { publicId, webhookSecret } = await activeConnection(
      'live',
      true,
      true,
    );
    await receiver.receive(
      publicId,
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('charge-dispute-created'), webhookSecret),
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
    await receiver.receive(
      publicId,
      delivery(fixture('charge-refunded'), webhookSecret),
    );
    await receiver.receive(
      publicId,
      delivery(fixture('charge-succeeded'), webhookSecret),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
  });

  it('a wrong URL secret or a wrong signature is rejected and nothing is stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('charge-succeeded'), 'wrong'),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('charge-succeeded'), webhookSecret, {
          signature: `t=${now()},v1=${'0'.repeat(64)}`,
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });

  it('a test-mode event on a live connection is dropped and never issues', async () => {
    const { publicId, webhookSecret } = await activeConnection('live');
    await expect(
      receiver.receive(
        publicId,
        delivery(
          changed('charge-succeeded', (e) => (e.livemode = false)),
          webhookSecret,
        ),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    await drain();
    expect(await count('integration_events')).toBe(0);
    expect(issuance.commands).toHaveLength(0);
  });

  it('a test-mode event on a test connection issues', async () => {
    const { publicId, webhookSecret } = await activeConnection('test');
    await receiver.receive(
      publicId,
      delivery(
        changed('charge-succeeded', (e) => (e.livemode = false)),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(1);
  });

  it('a partial refund and events the connector does not handle are acknowledged and not stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(
          changed('charge-refunded', (e) => (e.data.object.refunded = false)),
          webhookSecret,
        ),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    const other = JSON.stringify({
      id: 'evt_x',
      type: 'invoice.paid',
      livemode: true,
      data: { object: {} },
    });
    await expect(
      receiver.receive(publicId, delivery(other, webhookSecret)),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });
});
