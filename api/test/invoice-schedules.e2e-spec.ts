/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest/raw SQL responses are untyped */
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import { ScheduleRunner } from '@/modules/invoice-schedule/application/schedule-runner.service';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

const COMPANY_TAX_ID = '11222333000181';
const CUSTOMER_TAX_ID = '52998224725';
const ZONE = 'America/Sao_Paulo';

describe('schedules and recurring invoices (e2e)', () => {
  let ctx: E2eTestApp;
  let dataSource: DataSource;
  let tenantId: string;
  let testKey: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();
  const today = DateTime.now().setZone(ZONE).toISODate()!;
  const inDays = (days: number) =>
    DateTime.now().setZone(ZONE).plus({ days }).toISODate()!;

  const body = (options: Record<string, unknown>, extra = {}) => ({
    companyTaxId: COMPANY_TAX_ID,
    customer: { name: 'Cliente', taxId: CUSTOMER_TAX_ID },
    service: { description: 'Consultoria', code: '010101' },
    amount: 100,
    competenceDate: inDays(2),
    options,
    ...extra,
  });
  const post = (payload: unknown, key = testKey) =>
    request(ctx.app.getHttpServer())
      .post('/v1/invoices')
      .set(apiKeyHeader(key))
      .send(payload as object);
  const invoiceCount = () =>
    dataSource.getRepository(InvoiceOrmEntity).count({ where: { tenantId } });

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
    await dataSource.query(
      `INSERT INTO "${schema}"."nfse_companies"
         (id, tenant_id, legal_name, tax_id, municipality_code,
          municipal_reg, environment, status, created_at, updated_at)
       VALUES ($1, $2, 'Empresa Teste', $3, '3550308', '12345', 'test', 'ready', NOW(), NOW())`,
      [companyId, tenantId, COMPANY_TAX_ID],
    );
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('RECURRING creates a schedule (202) and issues no invoice yet', async () => {
    const before = await invoiceCount();
    const res = await post(
      body({ type: 'RECURRING', recurrence: { frequency: 'WEEKLY' } }),
    ).expect(202);
    expect(res.body.data).toMatchObject({
      kind: 'recurring',
      frequency: 'WEEKLY',
      status: 'active',
      next_run_on: inDays(2),
      attempts: 0,
      company_id: companyId,
    });
    expect(await invoiceCount()).toBe(before);
  });

  it('SCHEDULE creates a single schedule', async () => {
    const res = await post(body({ type: 'SCHEDULE' })).expect(202);
    expect(res.body.data).toMatchObject({ kind: 'once', frequency: null });
  });

  it('IMMEDIATE still issues an invoice, as before', async () => {
    const res = await post(
      body({ type: 'IMMEDIATE' }, { competenceDate: today }),
    ).expect(202);
    expect(res.body.data).toMatchObject({
      status: 'queued',
      environment: 'test',
    });
  });

  it('refuses a recurring request without frequency and a recurrence on an immediate one', async () => {
    const missing = await post(body({ type: 'RECURRING' })).expect(422);
    expect(missing.body.code).toBe('ERROR_VALIDATION');
    await post(
      body({ type: 'IMMEDIATE', recurrence: { frequency: 'WEEKLY' } }),
    ).expect(422);
    await post(body({ type: 'SCHEDULE' }, { competenceDate: today })).expect(
      422,
    );
  });

  it('lists, reads, pauses, resumes and cancels; a cancelled schedule cannot change', async () => {
    const created = await post(
      body({ type: 'RECURRING', recurrence: { frequency: 'MONTHLY' } }),
    ).expect(202);
    const id = created.body.data.id as string;
    const as = (
      method: 'get' | 'post' | 'patch',
      path: string,
      key = testKey,
    ) =>
      request(ctx.app.getHttpServer())
        [method](`/v1/schedules${path}`)
        .set(apiKeyHeader(key));

    const list = await as('get', '').expect(200);
    expect(
      (list.body.data as Array<{ id: string }>).map((s) => s.id),
    ).toContain(id);
    await as('get', `/${id}`).expect(200);

    const paused = await as('post', `/${id}/pause`).expect(200);
    expect(paused.body.data).toMatchObject({
      status: 'paused',
      pause_reason: 'customer',
      next_run_on: null,
    });
    const resumed = await as('post', `/${id}/resume`).expect(200);
    expect(resumed.body.data.status).toBe('active');

    const changed = await as('patch', `/${id}`)
      .send({ invoice: { amount: 250 } })
      .expect(200);
    expect(changed.body.data.invoice.amount).toBe(250);

    await as('post', `/${id}/cancel`).expect(200);
    const again = await as('post', `/${id}/pause`).expect(409);
    expect(again.body.code).toBe('ERROR_SCHEDULE_STATE');
    const runs = await as('get', `/${id}/runs`).expect(200);
    expect(runs.body.data).toEqual([]);
  });

  it('a live key does not see a test schedule', async () => {
    const created = await post(body({ type: 'SCHEDULE' })).expect(202);
    const id = created.body.data.id as string;
    const res = await request(ctx.app.getHttpServer())
      .get(`/v1/schedules/${id}`)
      .set(apiKeyHeader(ctx.apiKey))
      .expect(404);
    expect(res.body.code).toBe('ERROR_SCHEDULE_NOT_FOUND');
  });

  it('the daily run turns a due schedule into a real invoice with today as competence, logs it and moves on', async () => {
    const created = await post(
      body({ type: 'RECURRING', recurrence: { frequency: 'WEEKLY' } }),
    ).expect(202);
    const id = created.body.data.id as string;
    // Make it due now, as if its date had arrived.
    await dataSource.query(
      `UPDATE "${schema}".invoice_schedules SET next_run_on = $2 WHERE id = $1`,
      [id, today],
    );
    const before = await invoiceCount();

    const summary = await ctx.app
      .get(ScheduleRunner, { strict: false })
      .runDue(today);
    expect(summary.errors).toBe(0);
    expect(summary.issued).toBeGreaterThanOrEqual(1);
    expect(await invoiceCount()).toBeGreaterThan(before);

    const runs = await request(ctx.app.getHttpServer())
      .get(`/v1/schedules/${id}/runs`)
      .set(apiKeyHeader(testKey))
      .expect(200);
    expect(runs.body.data[0]).toMatchObject({
      outcome: 'issued',
      occurrence_on: today,
      ran_on: today,
      attempt: 1,
    });
    const invoice = await dataSource
      .getRepository(InvoiceOrmEntity)
      .findOneByOrFail({ id: runs.body.data[0].invoice_id as string });
    expect(String(invoice.competenceDate).slice(0, 10)).toBe(today);

    const after = await request(ctx.app.getHttpServer())
      .get(`/v1/schedules/${id}`)
      .set(apiKeyHeader(testKey))
      .expect(200);
    expect(after.body.data.next_run_on > today).toBe(true);
    expect(after.body.data.last_run_on).toBe(today);

    // Running again the same day issues nothing more for it.
    const second = await ctx.app
      .get(ScheduleRunner, { strict: false })
      .runDue(today);
    expect(second.errors).toBe(0);
    expect(await invoiceCount()).toBe(before + summary.issued);
  });
});
