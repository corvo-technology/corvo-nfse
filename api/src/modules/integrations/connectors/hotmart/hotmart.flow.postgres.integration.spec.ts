/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
import { HotmartConnector } from './hotmart.connector';
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

const schema = `integ_hotmart_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
// A token made for this run: the connector and the request in the test only need to agree with each other.
const HOTTOK = randomBytes(24).toString('hex');

type Json = Record<string, any>;

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8');
const changed = (name: string, change: (event: Json) => void) => {
  const event = JSON.parse(fixture(name)) as Json;
  change(event);
  return JSON.stringify(event);
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

describePostgres('Hotmart connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  /** The URL secret the client would copy from the create response. */
  async function activeConnection(
    options: {
      environment?: 'test' | 'live';
      allowAnonymousCustomer?: boolean;
      cancelOnRefund?: boolean;
      invoiceValue?: string;
    } = {},
  ) {
    const created = await connections.create(tenant, {
      provider: 'hotmart',
      companyId: company,
      environment: options.environment ?? 'live',
      credentials: {
        hottok: HOTTOK,
        ...(options.invoiceValue ? { invoiceValue: options.invoiceValue } : {}),
      },
    });
    const { webhookSecret } = connections.toView(created).credentials;
    await connections.validate(tenant, created.id);
    const allowAnonymousCustomer = options.allowAnonymousCustomer ?? true;
    const cancelOnRefund = options.cancelOnRefund ?? false;
    await connections.replaceRules(tenant, created.id, [
      {
        externalProductId: null,
        service: { code: '010101' },
        sendEmail: false,
        allowAnonymousCustomer,
        cancelOnRefund,
      },
      {
        externalProductId: '4000001',
        service: { code: '020202', description: 'Curso' },
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
    over: { hottok?: string } = {},
  ) => ({
    rawBody: Buffer.from(body),
    headers: { 'x-hotmart-hottok': over.hottok ?? HOTTOK },
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
    registry.register(new HotmartConnector());
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

  it('creating a connection needs only the hottok: the URL secret is generated and the option defaults to the total', async () => {
    const { webhookSecret } = await activeConnection();
    expect(webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const rows: Array<{ external_account_id: string }> = await db.query(
      `SELECT external_account_id FROM ${t('integration_connections')}`,
    );
    expect(rows[0].external_account_id).toMatch(/^hotmart:[0-9a-f]{24}$/);
  });

  it('refuses a value option that is not offered', async () => {
    await expect(
      connections.create(tenant, {
        provider: 'hotmart',
        companyId: company,
        environment: 'live',
        credentials: { hottok: HOTTOK, invoiceValue: 'half' },
      }),
    ).rejects.toThrow('Invalid value');
  });

  it('an approved sale issues one invoice with the product rule and the buyer document', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      allowAnonymousCustomer: false,
    });
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('purchase-approved'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 97.9,
      email: true,
      service: { code: '020202', description: 'Curso' },
      customer: { taxId: '52998224725', name: 'Maria Compradora' },
      externalId: 'hotmart:HP00000000000001',
    });
  });

  it('"minha parte" issues the total minus coproducer and affiliate', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      invoiceValue: 'share',
    });
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-approved'), webhookSecret),
    );
    await drain();
    expect(issuance.commands[0].request).toMatchObject({ amount: 72.4 });
  });

  it('APPROVED followed by COMPLETE does not issue a second invoice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-approved', (e) => {
          e.id = '00000000-0000-4000-8000-0000000000aa';
          e.event = 'PURCHASE_COMPLETE';
          e.data.purchase.status = 'COMPLETE';
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(await count('integration_events')).toBe(2);
    expect(await count('integration_operations')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('Hotmart retrying the same delivery does not issue twice', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    const body = fixture('purchase-approved');
    await Promise.all([
      receiver.receive(publicId, delivery(body, webhookSecret)),
      receiver.receive(publicId, delivery(body, webhookSecret)),
    ]);
    await receiver.receive(publicId, delivery(body, webhookSecret));
    await drain();
    expect(await count('integration_events')).toBe(1);
    expect(issuance.invoices.size).toBe(1);
  });

  it('a sale the Hotmart invoices is blocked with seller_not_issuer', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-approved', (e) => {
          e.data.purchase.invoice_by = 'HOTMART';
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('seller_not_issuer');
  });

  it('an affiliate notice is acknowledged and not stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(
          changed('purchase-approved', (e) => {
            delete e.data.buyer;
            delete e.data.purchase.full_price;
          }),
          webhookSecret,
        ),
      ),
    ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });

  it('a foreign buyer waits for the data to be completed', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      allowAnonymousCustomer: false,
    });
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-approved', (e) => {
          e.data.buyer.address.country_iso = 'PT';
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('customer_tax_id_missing');
  });

  it('a sale in another currency is blocked with unsupported_currency', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-approved', (e) => {
          e.data.purchase.full_price.currency_value = 'USD';
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await blockReason()).toBe('unsupported_currency');
  });

  it('with "cancel on refund" on, a refund after the invoice asks for that invoice to be cancelled, once', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      cancelOnRefund: true,
    });
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-refunded'), webhookSecret),
    );
    // A chargeback on the same sale is the same outcome and must not cancel twice.
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-refunded', (e) => {
          e.event = 'PURCHASE_CHARGEBACK';
        }),
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
      delivery(fixture('purchase-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-refunded'), webhookSecret),
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

  it('a protest after the invoice only flags it, even with "cancel on refund" on', async () => {
    const { publicId, webhookSecret } = await activeConnection({
      cancelOnRefund: true,
    });
    await receiver.receive(
      publicId,
      delivery(fixture('purchase-approved'), webhookSecret),
    );
    await drain();
    await receiver.receive(
      publicId,
      delivery(
        changed('purchase-refunded', (e) => {
          e.event = 'PURCHASE_PROTEST';
        }),
        webhookSecret,
      ),
    );
    await drain();
    expect(cancellation.calls).toHaveLength(0);
    const rows: Array<{ commercial_state: string }> = await db.query(
      `SELECT commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows).toEqual([{ commercial_state: 'disputed' }]);
  });

  it('a refund for a sale we never saw is dropped without blocking Hotmart', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('purchase-refunded'), webhookSecret),
      ),
    ).resolves.toEqual({ status: 'accepted' });
    await drain();
    expect(issuance.commands).toHaveLength(0);
    expect(await count('integration_operations')).toBe(0);
  });

  it('a wrong URL secret or a wrong hottok is rejected and nothing is stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('purchase-approved'), 'wrong'),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      receiver.receive(
        publicId,
        delivery(fixture('purchase-approved'), webhookSecret, {
          hottok: 'nope',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(await count('integration_events')).toBe(0);
  });

  it('events the connector does not handle are acknowledged and not stored', async () => {
    const { publicId, webhookSecret } = await activeConnection();
    for (const event of ['PURCHASE_CANCELED', 'PURCHASE_BILLET_PRINTED'])
      await expect(
        receiver.receive(
          publicId,
          delivery(
            changed('purchase-approved', (e) => (e.event = event)),
            webhookSecret,
          ),
        ),
      ).resolves.toEqual({ status: 'ignored' });
    expect(await count('integration_events')).toBe(0);
  });
});
