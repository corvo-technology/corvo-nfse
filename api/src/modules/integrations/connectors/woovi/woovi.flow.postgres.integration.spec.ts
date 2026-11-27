import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
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
import { WooviConnector } from './woovi.connector';
import type { WooviPublicKeyProvider } from './woovi-public-key.provider';

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

const schema = `integ_woovi_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'charge-completed.json'),
  'utf8',
);
/** The Authorization token the client pasted into Woovi's webhook headers. */
let webhookToken = '';
const signed = (body: string) => ({
  rawBody: Buffer.from(body),
  headers: {
    authorization: webhookToken,
    'x-webhook-signature': createSign('sha256')
      .update(body)
      .sign(privateKey, 'base64'),
  },
  query: {},
});

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

describePostgres('Woovi connector through the real pipeline', () => {
  let db: DataSource;
  let issuance: FakeIssuance;
  let connections: ConnectionService;
  let receiver: InboundReceiverService;
  let processor: EventProcessorService;
  const t = (name: string) => `"${schema}"."${name}"`;

  async function liveConnection(cancelOnRefund = false) {
    const created = await connections.create(tenant, {
      provider: 'woovi',
      companyId: company,
      environment: 'test',
      credentials: {},
    });
    webhookToken = connections.toView(created).credentials.webhookToken;
    await connections.validate(tenant, created.id);
    await connections.replaceRules(tenant, created.id, [
      {
        externalProductId: null,
        service: { code: '010101', description: 'Consultoria' },
        sendEmail: true,
        allowAnonymousCustomer: false,
        cancelOnRefund,
      },
    ]);
    return connections.activate(tenant, created.id);
  }
  const drain = async () => {
    for (let i = 0; i < 5; i++) if ((await processor.runOnce()) === 0) return;
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
    const keys = {
      getKeys: () => Promise.resolve([publicKey]),
    } as unknown as WooviPublicKeyProvider;
    const registry = new ConnectorRegistry();
    registry.register(new WooviConnector(keys));
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
      { findById: () => Promise.resolve({}) } as unknown as CompanyService,
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

  it('a signed paid charge issues one invoice with the charge customer, the amount in reais and the São Paulo date', async () => {
    const { publicId } = await liveConnection();
    await expect(receiver.receive(publicId, signed(fixture))).resolves.toEqual({
      status: 'accepted',
    });
    await drain();
    expect(issuance.commands).toHaveLength(1);
    expect(issuance.commands[0].request).toMatchObject({
      amount: 49.9,
      competenceDate: '2026-10-29',
      email: true,
      externalId: 'charge:pedido-123',
      customer: {
        name: 'Maria da Silva',
        taxId: '52998224725',
        email: 'maria@example.com',
      },
      service: { code: '010101' },
    });
  });

  it('Woovi retrying the same webhook, even in parallel, does not issue twice', async () => {
    const { publicId } = await liveConnection();
    await Promise.all([
      receiver.receive(publicId, signed(fixture)),
      receiver.receive(publicId, signed(fixture)),
    ]);
    await receiver.receive(publicId, signed(fixture));
    await drain();
    expect(issuance.invoices.size).toBe(1);
  });

  it('a bad signature is rejected and nothing is stored', async () => {
    const { publicId } = await liveConnection();
    const request = {
      ...signed(fixture),
      headers: {
        'x-webhook-signature': Buffer.from('nope').toString('base64'),
      },
    };
    await expect(receiver.receive(publicId, request)).rejects.toThrow(
      UnauthorizedException,
    );
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t('integration_events')}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('a call without the right Authorization token is refused and stores nothing', async () => {
    const { publicId } = await liveConnection();
    const request = {
      ...signed(fixture),
      headers: { ...signed(fixture).headers, authorization: 'wrong' },
    };
    await expect(receiver.receive(publicId, request)).rejects.toThrow();
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t('integration_events')}`,
    );
    expect(rows[0].n).toBe(0);
  });

  describe('refund after the invoice', () => {
    const refundBody = readFileSync(
      join(__dirname, '__fixtures__', 'refund-sent-confirmed.json'),
      'utf8',
    );
    const operationRow = async () => {
      const rows: Array<{
        commercial_state: string;
        fiscal_status: string;
        block_reason: string | null;
      }> = await db.query(
        `SELECT commercial_state, fiscal_status, block_reason FROM ${t('integration_operations')}`,
      );
      return rows;
    };

    it('with "cancel on refund" on, the refund finds the sale by the Pix end-to-end id and cancels its invoice', async () => {
      const { publicId } = await liveConnection(true);
      await receiver.receive(publicId, signed(fixture));
      await drain();
      await receiver.receive(publicId, signed(refundBody));
      await drain();
      const [invoiceId] = [...issuance.invoices.values()];
      expect(cancellation.calls).toEqual([
        {
          tenantId: tenant,
          environment: 'test',
          invoiceId,
          description: 'Cancelado por reembolso',
        },
      ]);
      expect(await operationRow()).toEqual([
        {
          commercial_state: 'refunded',
          fiscal_status: 'submitted',
          block_reason: 'cancel_requested',
        },
      ]);
    });

    it('with it off, only flags the refund', async () => {
      const { publicId } = await liveConnection(false);
      await receiver.receive(publicId, signed(fixture));
      await drain();
      await receiver.receive(publicId, signed(refundBody));
      await drain();
      expect(cancellation.calls).toHaveLength(0);
      expect(await operationRow()).toEqual([
        {
          commercial_state: 'refunded',
          fiscal_status: 'submitted',
          block_reason: 'refund_after_invoice',
        },
      ]);
    });

    it('a refund of a payment that is not a sale here is ignored and creates no sale', async () => {
      const { publicId } = await liveConnection(true);
      await receiver.receive(publicId, signed(refundBody));
      await drain();
      expect(cancellation.calls).toHaveLength(0);
      expect(await operationRow()).toEqual([]);
      const events: Array<{ state: string; last_error: string }> =
        await db.query(
          `SELECT state, last_error FROM ${t('integration_events')}`,
        );
      expect(events).toEqual([
        { state: 'ignored', last_error: 'refund_sale_not_found' },
      ]);
    });
  });

  it('the registration test webhook is acknowledged and stores nothing', async () => {
    const { publicId } = await liveConnection();
    await expect(
      receiver.receive(
        publicId,
        signed(JSON.stringify({ evento: 'teste_webhook' })),
      ),
    ).resolves.toEqual({ status: 'test' });
    const rows: Array<{ n: number }> = await db.query(
      `SELECT count(*)::int AS n FROM ${t('integration_events')}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('a sale with no document anywhere (charge customer or Pix payer) waits for the customer to be completed', async () => {
    const { publicId } = await liveConnection();
    const data = JSON.parse(fixture) as {
      charge: { customer: { taxID?: unknown } };
      pix: { payer: { taxID?: unknown } };
    };
    delete data.charge.customer.taxID;
    delete data.pix.payer.taxID;
    await receiver.receive(publicId, signed(JSON.stringify(data)));
    await drain();
    expect(issuance.commands).toHaveLength(0);
    const rows: Array<{ block_reason: string }> = await db.query(
      `SELECT block_reason FROM ${t('integration_operations')}`,
    );
    expect(rows[0].block_reason).toBe('customer_tax_id_missing');
  });

  it('a charge customer without a document falls back to the Pix payer and issues the invoice', async () => {
    const { publicId } = await liveConnection();
    const data = JSON.parse(fixture) as {
      charge: { customer: { taxID?: unknown } };
    };
    delete data.charge.customer.taxID;
    await receiver.receive(publicId, signed(JSON.stringify(data)));
    await drain();
    expect(issuance.commands).toHaveLength(1);
  });
});
