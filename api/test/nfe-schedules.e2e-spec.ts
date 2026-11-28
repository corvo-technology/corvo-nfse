/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies and raw SQL rows are untyped */
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ScheduleRunner } from '@/modules/invoice-schedule/application/schedule-runner.service';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

/** NF-e schedules (`POST /v1/invoices` with `type: "nfe"` and `options.type`) against the real app and database. */
const COMPANY_TAX_ID = '11222333000181';
const ZONE = 'America/Sao_Paulo';

const nfe = (companyId: string, overrides: Record<string, unknown> = {}) => ({
  type: 'nfe',
  companyId,
  recipient: {
    taxId: '123.456.789-09',
    name: 'Maria da Silva',
    indIeDest: 9,
    email: 'maria@example.com',
    address: {
      street: 'Rua das Flores',
      number: '10',
      district: 'Centro',
      zip: '01001-000',
      cityCode: '3550308',
      city: 'São Paulo',
      state: 'SP',
    },
  },
  items: [
    {
      code: 'SKU1',
      description: 'Produto de teste',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      quantity: 2,
      unitPrice: 10,
    },
  ],
  payments: [{ tPag: '17', amount: 20 }],
  ...overrides,
});

describe('NF-e schedules (e2e)', () => {
  let ctx: E2eTestApp;
  let db: DataSource;
  let tenantId: string;
  let key: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();
  const today = DateTime.now().setZone(ZONE).toISODate()!;
  const inDays = (days: number) =>
    DateTime.now().setZone(ZONE).plus({ days }).toISODate()!;
  const options = (type: string, extra = {}) => ({ type, ...extra });

  const post = (payload: unknown, idempotency?: string) => {
    const req = request(ctx.app.getHttpServer())
      .post('/v1/invoices')
      .set(apiKeyHeader(key));
    return (idempotency ? req.set('Idempotency-Key', idempotency) : req).send(
      payload as object,
    );
  };
  const nfeCount = async (): Promise<number> => {
    const rows: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM "${schema}".nfe_documents WHERE tenant_id = $1`,
      [tenantId],
    );
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    ctx = await createSeededE2eApp();
    db = ctx.dataSource;
    tenantId = ctx.tenantId;
    const hex = randomBytes(20).toString('hex');
    key = `corvo_test_${hex}`;
    await db.query(
      `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
       VALUES ($1, $2, 'e2e-nfe-schedules', 'test', $3, $4, 'full_access', NOW())`,
      [
        randomUUID(),
        tenantId,
        `corvo_test_${hex.substring(0, 12)}`,
        await argon2.hash(key),
      ],
    );
    await db.query(
      `INSERT INTO "${schema}".nfse_companies
         (id, tenant_id, legal_name, tax_id, municipality_code, environment, status,
          address_street, address_number, address_district, address_zip, address_city, address_state,
          created_at, updated_at)
       VALUES ($1, $2, 'Empresa Teste LTDA', $3, '3550308', 'test', 'ready',
          'Avenida Paulista', '1000', 'Bela Vista', '01310100', 'São Paulo', 'SP', NOW(), NOW())`,
      [companyId, tenantId, COMPANY_TAX_ID],
    );
    await request(ctx.app.getHttpServer())
      .put(`/v1/companies/${companyId}/nfe-settings`)
      .set(apiKeyHeader(key))
      .send({ stateRegistration: '110042490114', crt: 1 })
      .expect(200);
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('RECURRING creates an NF-e schedule (202), checked now, and issues nothing yet', async () => {
    const before = await nfeCount();
    const res = await post(
      nfe(companyId, {
        competenceDate: inDays(2),
        options: options('RECURRING', { recurrence: { frequency: 'MONTHLY' } }),
      }),
    ).expect(202);
    expect(res.body.data).toMatchObject({
      type: 'nfe',
      kind: 'recurring',
      frequency: 'MONTHLY',
      status: 'active',
      next_run_on: inDays(2),
      company_id: companyId,
    });
    expect(res.body.data.invoice.items).toHaveLength(1);
    expect(res.body.data.invoice.options).toBeUndefined();
    expect(await nfeCount()).toBe(before);
  });

  it('a broken NF-e never becomes a schedule: 422 with every problem, nothing saved', async () => {
    const payload = nfe(companyId);
    const res = await post({
      ...payload,
      competenceDate: inDays(2),
      options: options('SCHEDULE'),
      items: [{ ...payload.items[0], ncm: '1234567' }],
    }).expect(422);
    expect(res.body.code).toBe('ERROR_NFE_VALIDATION_FAILED');
    const rows: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM "${schema}".invoice_schedules WHERE tenant_id = $1 AND document_type = 'nfe' AND invoice_input -> 'items' -> 0 ->> 'ncm' = '1234567'`,
      [tenantId],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('a recipient without address is refused at creation', async () => {
    const payload = nfe(companyId);
    const { address: _address, ...recipient } = payload.recipient;
    const res = await post({
      ...payload,
      recipient,
      competenceDate: inDays(2),
      options: options('SCHEDULE'),
    });
    // The same 400 the dry-run gives: the address of the recipient is part of the NF-e.
    expect(res.status).toBe(400);
  });

  it('a NFC-e cannot be scheduled: 422 INVOICE_OPERATION_NOT_SUPPORTED', async () => {
    const res = await post({
      type: 'nfce',
      companyId,
      items: [
        {
          code: 'X',
          description: 'Produto',
          ncm: '61091000',
          cfop: '5102',
          unit: 'UN',
          quantity: 1,
          unitPrice: 5,
        },
      ],
      payments: [{ tPag: '01', amount: 5 }],
      competenceDate: inDays(2),
      options: options('SCHEDULE'),
    }).expect(422);
    expect(res.body.code).toBe('ERROR_INVOICE_OPERATION_NOT_SUPPORTED');
  });

  it('the first date follows the NFS-e rule: tomorrow or later', async () => {
    const res = await post(
      nfe(companyId, { competenceDate: today, options: options('SCHEDULE') }),
    );
    expect(res.status).toBe(422);
  });

  it('the Idempotency-Key replays the same schedule', async () => {
    const payload = nfe(companyId, {
      competenceDate: inDays(3),
      options: options('SCHEDULE'),
    });
    const first = await post(payload, 'e2e-nfe-sched-1').expect(202);
    const again = await post(payload, 'e2e-nfe-sched-1').expect(202);
    expect(again.body.data.id).toBe(first.body.data.id);
  });

  it('GET /schedules says the type and filters by it; pause, resume, update and cancel work', async () => {
    const created = await post(
      nfe(companyId, {
        competenceDate: inDays(4),
        options: options('SCHEDULE'),
      }),
    ).expect(202);
    const id = created.body.data.id as string;
    const as = (method: 'get' | 'post' | 'patch', path = '') =>
      request(ctx.app.getHttpServer())
        [method](`/v1/schedules${path}`)
        .set(apiKeyHeader(key));

    const list = await as('get', '?type=nfe').expect(200);
    const rows = list.body.data as Array<{ id: string; type: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.type === 'nfe')).toBe(true);
    expect(rows.map((row) => row.id)).toContain(id);
    const nfse = await as('get', '?type=nfse').expect(200);
    expect(
      (nfse.body.data as Array<{ id: string }>).map((row) => row.id),
    ).not.toContain(id);

    await as('post', `/${id}/pause`).expect(200);
    await as('post', `/${id}/resume`).expect(200);
    const items = [
      {
        code: 'SKU1',
        description: 'Produto de teste',
        ncm: '61091000',
        cfop: '5102',
        unit: 'UN',
        quantity: 3,
        unitPrice: 10,
      },
    ];
    const changed = await as('patch', `/${id}`)
      .send({ invoice: { items, payments: [{ tPag: '17', amount: 30 }] } })
      .expect(200);
    expect(changed.body.data.invoice.items[0].quantity).toBe(3);
    // The NF-e is checked again: a total that does not match the payments is refused.
    await as('patch', `/${id}`)
      .send({ invoice: { items: [{ ...items[0], quantity: 5 }] } })
      .expect(422);
    await as('patch', `/${id}`)
      .send({ invoice: { companyId: randomUUID() } })
      .expect(422);
    await as('post', `/${id}/cancel`).expect(200);
  });

  it('the daily run queues a real NF-e once, logs it, and running again does not duplicate it', async () => {
    const created = await post(
      nfe(companyId, {
        competenceDate: inDays(2),
        options: options('RECURRING', { recurrence: { frequency: 'WEEKLY' } }),
      }),
    ).expect(202);
    const id = created.body.data.id as string;
    await db.query(
      `UPDATE "${schema}".invoice_schedules SET next_run_on = $2 WHERE id = $1`,
      [id, today],
    );
    const before = await nfeCount();
    const runner = ctx.app.get(ScheduleRunner, { strict: false });

    const summary = await runner.runDue(today);
    expect(summary.errors).toBe(0);
    expect(await nfeCount()).toBe(before + summary.issued);

    const runs = await request(ctx.app.getHttpServer())
      .get(`/v1/schedules/${id}/runs`)
      .set(apiKeyHeader(key))
      .expect(200);
    expect(runs.body.data[0]).toMatchObject({
      outcome: 'issued',
      occurrence_on: today,
      attempt: 1,
    });
    const note: Array<{ idempotency_key: string; model: number }> =
      await db.query(
        `SELECT idempotency_key, model FROM "${schema}".nfe_documents WHERE id = $1`,
        [runs.body.data[0].invoice_id],
      );
    expect(note[0]).toEqual({
      idempotency_key: `schedule:${id}:${today}`,
      model: 55,
    });

    await db.query(
      `UPDATE "${schema}".invoice_schedules SET next_run_on = $2 WHERE id = $1`,
      [id, today],
    );
    await runner.runDue(today);
    const copies: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM "${schema}".nfe_documents WHERE idempotency_key = $1`,
      [`schedule:${id}:${today}`],
    );
    expect(Number(copies[0].n)).toBe(1);
  });
});
