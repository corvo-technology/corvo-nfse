import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmIntegrationOperationRepository } from './typeorm-integration-operation.repository';
import { TypeOrmIntegrationRuleRepository } from './typeorm-integration-rule.repository';
import { IntegrationOperationOrmEntity } from './integration-operation.orm-entity';
import { IntegrationRuleOrmEntity } from './integration-rule.orm-entity';
import type { NormalizedOperation } from '../domain/connector';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);
const schema = `integ_ops_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
const connectionId = randomUUID();

const normalized = (
  over: Partial<NormalizedOperation> = {},
): NormalizedOperation => ({
  operationKey: 'charge:1',
  commercialState: 'paid',
  externalRefs: {},
  occurredAt: new Date('2026-10-29T12:00:00Z'),
  paidAt: new Date('2026-10-29T12:00:00Z'),
  currency: 'BRL',
  amountCents: 4990,
  discountCents: 0,
  customer: { name: 'M', email: null, taxId: null, taxIdMasked: true },
  items: [],
  sellerIssuesInvoice: true,
  ...over,
});

describePostgres('integration operations and rules on real PostgreSQL', () => {
  let db: DataSource;
  let ops: TypeOrmIntegrationOperationRepository;
  let rules: TypeOrmIntegrationRuleRepository;
  const t = (name: string) => `"${schema}"."${name}"`;
  const upsert = (n: NormalizedOperation) =>
    ops.upsertFromNormalized({
      tenantId: tenant,
      connectionId,
      provider: 'woovi',
      environment: 'test',
      externalAccountId: 'acc',
      normalized: n,
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
    await db.query(
      `INSERT INTO ${t('integration_connections')} (id,tenant_id,company_id,public_id,provider,environment,external_account_id,state,credentials_enc) VALUES ($1,$2,$3,'pub','woovi','test','acc','active','enc')`,
      [connectionId, tenant, company],
    );
    ops = new TypeOrmIntegrationOperationRepository(
      db.getRepository(IntegrationOperationOrmEntity),
    );
    rules = new TypeOrmIntegrationRuleRepository(
      db.getRepository(IntegrationRuleOrmEntity),
    );
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.destroy();
  });
  beforeEach(() => db.query(`DELETE FROM ${t('integration_operations')}`));

  it('findByExternalRef finds the sale by a reference kept in its snapshot, in this connection only', async () => {
    const sale = await upsert(
      normalized({
        operationKey: 'charge:with-ref',
        externalRefs: { pixEndToEndId: 'E-1' },
      }),
    );
    await upsert(
      normalized({
        operationKey: 'charge:other',
        externalRefs: { pixEndToEndId: 'E-2' },
      }),
    );
    const find = (ref: string, value: string, conn = connectionId) =>
      ops.findByExternalRef({
        tenantId: tenant,
        connectionId: conn,
        ref,
        value,
      });
    await expect(find('pixEndToEndId', 'E-1')).resolves.toMatchObject({
      id: sale.id,
      operationKey: 'charge:with-ref',
    });
    await expect(find('pixEndToEndId', 'nope')).resolves.toBeNull();
    await expect(find('otherRef', 'E-1')).resolves.toBeNull();
    await expect(
      find('pixEndToEndId', 'E-1', randomUUID()),
    ).resolves.toBeNull();
  });

  it('upsert twice with the same key keeps one row and rehydrates dates', async () => {
    const first = await upsert(normalized());
    const second = await upsert(normalized());
    expect(second.id).toBe(first.id);
    expect(second.snapshot.paidAt).toBeInstanceOf(Date);
    const rows: Array<{ count: number }> = await db.query(
      `SELECT count(*)::int AS count FROM ${t('integration_operations')}`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('a late paid never overrides refunded', async () => {
    await upsert(
      normalized({
        commercialState: 'refunded',
        occurredAt: new Date('2026-10-29T13:00:00Z'),
      }),
    );
    const after = await upsert(normalized({ commercialState: 'paid' }));
    expect(after.commercialState).toBe('refunded');
    expect(after.snapshot.commercialState).toBe('refunded');
  });

  it('paid then refunded advances', async () => {
    await upsert(normalized());
    const after = await upsert(
      normalized({
        commercialState: 'refunded',
        occurredAt: new Date('2026-10-29T14:00:00Z'),
      }),
    );
    expect(after.commercialState).toBe('refunded');
  });

  it('an older occurredAt of the same state does not replace the snapshot', async () => {
    await upsert(
      normalized({
        amountCents: 4990,
        occurredAt: new Date('2026-10-29T12:00:00Z'),
      }),
    );
    const after = await upsert(
      normalized({
        amountCents: 1,
        occurredAt: new Date('2026-10-29T10:00:00Z'),
      }),
    );
    expect(after.snapshot.amountCents).toBe(4990);
    const newer = await upsert(
      normalized({
        amountCents: 5500,
        occurredAt: new Date('2026-10-29T13:00:00Z'),
      }),
    );
    expect(newer.snapshot.amountCents).toBe(5500);
  });

  it('canceled is final and only a pending operation becomes canceled', async () => {
    await upsert(
      normalized({ operationKey: 'k-pending', commercialState: 'pending' }),
    );
    expect(
      (
        await upsert(
          normalized({
            operationKey: 'k-pending',
            commercialState: 'canceled',
          }),
        )
      ).commercialState,
    ).toBe('canceled');
    expect(
      (
        await upsert(
          normalized({ operationKey: 'k-pending', commercialState: 'paid' }),
        )
      ).commercialState,
    ).toBe('canceled');
    await upsert(normalized({ operationKey: 'k-paid' }));
    expect(
      (
        await upsert(
          normalized({ operationKey: 'k-paid', commercialState: 'canceled' }),
        )
      ).commercialState,
    ).toBe('paid');
  });

  it('parallel refunded and paid upserts end in refunded', async () => {
    await Promise.all([
      upsert(
        normalized({
          commercialState: 'refunded',
          occurredAt: new Date('2026-10-29T13:00:00Z'),
        }),
      ),
      upsert(normalized()),
    ]);
    const rows: Array<{ commercial_state: string }> = await db.query(
      `SELECT commercial_state FROM ${t('integration_operations')}`,
    );
    expect(rows[0].commercial_state).toBe('refunded');
  });

  it('freezeEmission stores the first request and keeps it on later calls', async () => {
    const op = await upsert(normalized());
    const first = await ops.freezeEmission(op.id, tenant, {
      ruleId: randomUUID(),
      request: { amount: 49.9 },
      requestHash: 'h1',
      idempotencyKey: 'k1',
    });
    const second = await ops.freezeEmission(op.id, tenant, {
      ruleId: randomUUID(),
      request: { amount: 99 },
      requestHash: 'h2',
      idempotencyKey: 'k2',
    });
    expect(first.emissionRequestHash).toBe('h1');
    expect(second.emissionRequest).toEqual({ amount: 49.9 });
    expect(second.idempotencyKey).toBe('k1');
  });

  it('updateCustomer works until the request is frozen', async () => {
    const op = await upsert(normalized());
    const updated = await ops.updateCustomer(op.id, tenant, {
      name: 'Maria',
      email: null,
      taxId: '52998224725',
      taxIdMasked: false,
    });
    expect(updated?.snapshot.customer).toMatchObject({
      taxId: '52998224725',
      taxIdMasked: false,
    });
    await ops.freezeEmission(op.id, tenant, {
      ruleId: randomUUID(),
      request: {},
      requestHash: 'h',
      idempotencyKey: 'k',
    });
    await expect(
      ops.updateCustomer(op.id, tenant, {
        name: 'X',
        email: null,
        taxId: '11122233396',
        taxIdMasked: false,
      }),
    ).resolves.toBeNull();
  });

  it('updateCustomer stores a name with quotes as plain data', async () => {
    const op = await upsert(normalized());
    const name = `O'Brien'); DROP TABLE x; --`;
    const updated = await ops.updateCustomer(op.id, tenant, {
      name,
      email: null,
      taxId: '52998224725',
      taxIdMasked: false,
    });
    expect(updated?.snapshot.customer?.name).toBe(name);
  });

  it('unfreezeEmission releases the frozen request so it can be frozen again', async () => {
    const op = await upsert(normalized());
    await ops.freezeEmission(op.id, tenant, {
      ruleId: randomUUID(),
      request: { a: 1 },
      requestHash: 'h1',
      idempotencyKey: 'k1',
    });
    await ops.unfreezeEmission(op.id, tenant);
    const refrozen = await ops.freezeEmission(op.id, tenant, {
      ruleId: randomUUID(),
      request: { a: 2 },
      requestHash: 'h2',
      idempotencyKey: 'k1',
    });
    expect(refrozen.emissionRequest).toEqual({ a: 2 });
  });

  it('setFiscal records status, reason and invoice id', async () => {
    const op = await upsert(normalized());
    const invoiceId = randomUUID();
    await ops.setFiscal(op.id, tenant, 'submitted', null, invoiceId);
    const stored = await ops.findById(op.id, tenant);
    expect(stored).toMatchObject({
      fiscalStatus: 'submitted',
      blockReason: null,
      invoiceId,
    });
  });

  it('replaceForConnection swaps the whole rule set and counts it', async () => {
    await rules.replaceForConnection(connectionId, tenant, [
      {
        externalProductId: null,
        service: { code: '010101' },
        sendEmail: true,
        allowAnonymousCustomer: false,
        cancelOnRefund: false,
      },
      {
        externalProductId: 'p1',
        service: { code: '020202' },
        sendEmail: false,
        allowAnonymousCustomer: true,
        cancelOnRefund: false,
      },
    ]);
    expect(await rules.countByConnection(connectionId, tenant)).toBe(2);
    await rules.replaceForConnection(connectionId, tenant, [
      {
        externalProductId: null,
        service: { code: '030303' },
        sendEmail: false,
        allowAnonymousCustomer: false,
        cancelOnRefund: false,
      },
    ]);
    const list = await rules.listByConnection(connectionId, tenant);
    expect(list).toHaveLength(1);
    expect(list[0].service).toEqual({ code: '030303' });
  });
});
