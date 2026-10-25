/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

const COMPANY_A_TAX_ID = '11222333000181';
const COMPANY_B_TAX_ID = '45723174000110';
const CUSTOMER_TAX_ID = '52998224725';
const COMPETENCE_DATE = '2026-09-01';

describe('POST /v1/invoices/batches (e2e)', () => {
  let ctx: E2eTestApp;
  let dataSource: DataSource;
  let tenantId: string;
  let testKey: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyA = randomUUID();
  const companyB = randomUUID();

  const batch = (invoices: unknown, key = testKey) =>
    request(ctx.app.getHttpServer())
      .post('/v1/invoices/batches')
      .set(apiKeyHeader(key))
      .send({ invoices });
  const row = (taxId: string, idempotencyKey: string, extra = {}) => ({
    companyTaxId: taxId,
    idempotencyKey,
    customer: { name: 'Cliente', taxId: CUSTOMER_TAX_ID },
    service: { description: 'Consultoria', code: '010101' },
    amount: 100,
    competenceDate: COMPETENCE_DATE,
    ...extra,
  });
  const count = (companyId: string) =>
    dataSource.getRepository(InvoiceOrmEntity).count({
      where: { tenantId, companyId },
    });

  beforeAll(async () => {
    ctx = await createSeededE2eApp();
    dataSource = ctx.dataSource;
    tenantId = ctx.tenantId;
    const tokenHex = randomBytes(20).toString('hex');
    testKey = `corvo_test_${tokenHex}`;
    await dataSource.query(
      `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
       VALUES ($1, $2, 'e2e-test-env', 'test', $3, $4, 'full_access', NOW())`,
      [
        randomUUID(),
        tenantId,
        `corvo_test_${tokenHex.substring(0, 12)}`,
        await argon2.hash(testKey),
      ],
    );
    for (const [id, taxId] of [
      [companyA, COMPANY_A_TAX_ID],
      [companyB, COMPANY_B_TAX_ID],
    ] as const)
      await dataSource.query(
        `INSERT INTO "${schema}"."nfse_companies"
           (id, tenant_id, legal_name, tax_id, municipality_code,
            municipal_reg, environment, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())`,
        [id, tenantId, `Empresa ${taxId}`, taxId],
      );
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('saves valid items of several companies, rejects the invalid one and replays on retry', async () => {
    const items = () => [
      row(COMPANY_A_TAX_ID, 'e2e-row-1'),
      row(COMPANY_B_TAX_ID, 'e2e-row-2'),
      row(COMPANY_A_TAX_ID, 'e2e-row-3', { amount: -5 }),
      row('99999999999999', 'e2e-row-4'),
    ];

    const first = await batch(items()).expect(202);
    expect(first.body.data).toMatchObject({
      total: 4,
      accepted: 2,
      rejected: 2,
    });
    const results = first.body.data.results as Array<Record<string, any>>;
    expect(results.map((r) => [r.index, r.status])).toEqual([
      [0, 'accepted'],
      [1, 'accepted'],
      [2, 'rejected'],
      [3, 'rejected'],
    ]);
    expect(results[0]?.invoice).toMatchObject({
      status: 'queued',
      environment: 'test',
      idempotencyKey: 'e2e-row-1',
    });
    expect(results[2]?.error.code).toBe('ERROR_VALIDATION');
    expect(results[3]?.error.code).toBe('ERROR_COMPANY_NOT_FOUND');
    expect(await count(companyA)).toBe(1);
    expect(await count(companyB)).toBe(1);

    const retry = await batch(items()).expect(202);
    const again = retry.body.data.results as Array<Record<string, any>>;
    expect(again[0]).toMatchObject({ status: 'accepted', replayed: true });
    expect(again[0]?.invoice.id).toBe(results[0]?.invoice.id);
    expect(again[1]?.invoice.id).toBe(results[1]?.invoice.id);
    expect(await count(companyA)).toBe(1);
    expect(await count(companyB)).toBe(1);
  });

  it('rejects the second use of an idempotencyKey inside the same batch', async () => {
    const res = await batch([
      row(COMPANY_A_TAX_ID, 'e2e-dup'),
      row(COMPANY_A_TAX_ID, 'e2e-dup'),
    ]).expect(202);
    expect(res.body.data.results[0].status).toBe('accepted');
    expect(res.body.data.results[1].error.code).toBe(
      'ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH',
    );
  });

  it('accepts exactly 50 items in one request', async () => {
    const res = await batch(
      Array.from({ length: 50 }, (_, i) =>
        row(COMPANY_B_TAX_ID, `e2e-fifty-${i}`),
      ),
    ).expect(202);
    expect(res.body.data).toMatchObject({
      total: 50,
      accepted: 50,
      rejected: 0,
    });
  });

  it('requires an API key', async () => {
    await request(ctx.app.getHttpServer())
      .post('/v1/invoices/batches')
      .send({ invoices: [row(COMPANY_A_TAX_ID, 'x')] })
      .expect(401);
  });

  it('in live, rejects items of a company that is not ready and consumes no credit', async () => {
    const res = await batch(
      [row(COMPANY_A_TAX_ID, 'e2e-live')],
      ctx.apiKey,
    ).expect(202);
    expect(res.body.data).toMatchObject({ accepted: 0, rejected: 1 });
    expect(res.body.data.results[0].error.code).toMatch(/^ERROR_/);
    const [{ reserved }] = await dataSource.query(
      `SELECT COALESCE(SUM(reserved),0)::int AS reserved FROM "${schema}".billing_usage_periods WHERE tenant_id=$1`,
      [tenantId],
    );
    expect(reserved).toBe(0);
  });
});
