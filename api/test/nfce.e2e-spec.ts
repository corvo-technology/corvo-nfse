/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies and raw SQL rows are untyped */
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

/** `POST /v1/invoices` with `type: "nfce"` and what hangs from it, against the real app and database. */
const COMPANY_TAX_ID = '11222333000181';

const nfceBody = (companyId: string, extra: Record<string, unknown> = {}) => ({
  type: 'nfce',
  companyId,
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
  ...extra,
});

const nfeBody = (companyId: string) => ({
  type: 'nfe',
  companyId,
  recipient: {
    taxId: '123.456.789-09',
    name: 'Maria da Silva',
    indIeDest: 9,
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
  items: nfceBody(companyId).items,
  payments: [{ tPag: '17', amount: 20 }],
});

describe('NFC-e emission routes (e2e)', () => {
  let ctx: E2eTestApp;
  let db: DataSource;
  let tenantId: string;
  let key: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();

  const api = (method: 'get' | 'post' | 'put', path: string) =>
    request(ctx.app.getHttpServer())
      [method](`/v1${path}`)
      .set(apiKeyHeader(key));
  const create = (body: unknown, idempotencyKey?: string) => {
    const req = api('post', '/invoices');
    return (
      idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req
    ).send(body as object);
  };
  const dropCache = () =>
    ctx.moduleFixture
      .get<CachePort>(CACHE_PORT)
      .delete(`nfce:enabled:${tenantId}`);

  beforeAll(async () => {
    ctx = await createSeededE2eApp();
    db = ctx.dataSource;
    tenantId = ctx.tenantId;
    const hex = randomBytes(20).toString('hex');
    key = `corvo_test_${hex}`;
    await db.query(
      `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
       VALUES ($1, $2, 'e2e-nfce-emit', 'test', $3, $4, 'full_access', NOW())`,
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
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('answers 404 while the tenant has no NFC-e release, even with the NF-e released', async () => {
    await db.query(
      `UPDATE "${schema}".tenants SET nfe_enabled_at = NOW() WHERE id = $1`,
      [tenantId],
    );
    await dropCache();
    const res = await create(nfceBody(companyId), 'nfce-gate-1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ERROR_RESOURCE_NOT_FOUND');
    const list = await api('get', '/invoices?type=nfce');
    expect(list.status).toBe(404);
  });

  describe('with the NFC-e released', () => {
    beforeAll(async () => {
      await api('put', `/companies/${companyId}/nfe-settings`)
        .send({ stateRegistration: '110042490114', crt: 1 })
        .expect(200);
      await db.query(
        `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
         VALUES ('SP', 55, 2, now(), 'docs/fiscal/nfe-runbook.md'), ('SP', 65, 2, now(), 'docs/fiscal/nfe-runbook.md')`,
      );
      await db.query(
        `UPDATE "${schema}".tenants SET nfce_enabled_at = NOW() WHERE id = $1`,
        [tenantId],
      );
      await dropCache();
    });

    it('requires the Idempotency-Key', async () => {
      const res = await create(nfceBody(companyId));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ERROR_IDEMPOTENCY_KEY_REQUIRED');
    });

    it('accepts a NFC-e: 202, model 65 on the row, no number yet, one emit message', async () => {
      const res = await create(nfceBody(companyId), 'nfce-emit-1');
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        type: 'nfce',
        status: 'queued',
      });
      const id = res.body.data.id as string;
      const [row] = await db.query(
        `SELECT model, status, number, recipient, tp_imp FROM "${schema}".nfe_documents WHERE id = $1`,
        [id],
      );
      expect(row).toMatchObject({
        model: 65,
        status: 'queued',
        number: null,
        recipient: null,
        tp_imp: 4,
      });
      const [outbox] = await db.query(
        `SELECT count(*)::int AS n FROM "${schema}".outbox_messages WHERE aggregate_id = $1 AND type = 'nfe.emit'`,
        [id],
      );
      expect(outbox.n).toBe(1);

      const again = await create(nfceBody(companyId), 'nfce-emit-1');
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual({
        type: 'nfce',
        id,
        status: 'queued',
        replayed: true,
      });
      const other = await create(
        nfceBody(companyId, { additionalInfo: 'outro corpo' }),
        'nfce-emit-1',
      );
      expect(other.status).toBe(409);
    });

    it('the same Idempotency-Key with an NF-e body is a conflict, not a replay', async () => {
      const first = await create(nfceBody(companyId), 'nfce-emit-shared');
      expect(first.status).toBe(202);
      const nfe = await create(nfeBody(companyId), 'nfce-emit-shared');
      expect(nfe.status).toBe(409);
      expect(nfe.body.code).toBe('ERROR_IDEMPOTENCY_KEY_REUSED');
    });

    it('refuses what the checks refuse before saving anything (422) and what the body does not allow (400)', async () => {
      const before = await db.query(
        `SELECT count(*)::int AS n FROM "${schema}".nfe_documents WHERE tenant_id = $1`,
        [tenantId],
      );
      const delivery = await create(
        nfceBody(companyId, {
          indPres: 4,
          recipient: { taxId: '123.456.789-09', name: 'Maria' },
        }),
        'nfce-emit-delivery',
      );
      expect(delivery.status).toBe(422);
      expect(delivery.body.details).toEqual([
        expect.objectContaining({
          code: 'ERROR_NFCE_DELIVERY_ADDRESS_REQUIRED',
        }),
      ]);
      const natOp = await create(
        nfceBody(companyId, { natOp: 'Venda' }),
        'nfce-emit-natop',
      );
      expect(natOp.status).toBe(400);
      const after = await db.query(
        `SELECT count(*)::int AS n FROM "${schema}".nfe_documents WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(after[0].n).toBe(before[0].n);
    });

    it('keeps the models apart: type=nfce lists only NFC-e, type=nfe only NF-e, type=all both', async () => {
      const nfce = await create(
        nfceBody(companyId, { additionalInfo: 'lista' }),
        'nfce-list-1',
      );
      const nfe = await create(nfeBody(companyId), 'nfe-list-1');
      expect(nfe.status).toBe(202);
      const nfceId = nfce.body.data.id as string;
      const nfeId = nfe.body.data.id as string;
      const ids = async (type: string) => {
        const res = await api(
          'get',
          `/invoices?type=${type}&companyId=${companyId}&limit=100`,
        );
        expect(res.status).toBe(200);
        return (res.body.data as Array<{ id: string }>).map((row) => row.id);
      };
      const onlyNfce = await ids('nfce');
      expect(onlyNfce).toContain(nfceId);
      expect(onlyNfce).not.toContain(nfeId);
      const onlyNfe = await ids('nfe');
      expect(onlyNfe).toContain(nfeId);
      expect(onlyNfe).not.toContain(nfceId);
      const all = await ids('all');
      expect(all).toEqual(expect.arrayContaining([nfceId, nfeId]));

      // Each id is read by its own model, and keeps its type.
      const readNfce = await api('get', `/invoices/${nfceId}`);
      expect(readNfce.body.data).toMatchObject({ type: 'nfce', model: 65 });
      const readNfe = await api('get', `/invoices/${nfeId}`);
      expect(readNfe.body.data).toMatchObject({ type: 'nfe', model: 55 });
      expect(readNfe.body.data).not.toHaveProperty('qrCode');
    });

    it('answers 422 INVOICE_OPERATION_NOT_SUPPORTED to a correction letter on a NFC-e', async () => {
      const created = await create(
        nfceBody(companyId, { additionalInfo: 'cce' }),
        'nfce-cce-1',
      );
      const id = created.body.data.id as string;
      await db.query(
        `UPDATE "${schema}".nfe_documents SET status = 'authorized', number = 5, series = 1,
           access_key = '35261111222333000181650010000000051123456780', protocol = '135260000000001',
           signed_xml = '<NFe/>', issued_at = now(), authorized_at = now() WHERE id = $1`,
        [id],
      );
      const res = await api('post', `/invoices/${id}/corrections`).send({
        correction: 'Corrigir o endereço de entrega da observação',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ERROR_INVOICE_OPERATION_NOT_SUPPORTED');
    });

    it('only an authorized NFC-e can be cancelled; the asked cancellation queues one event', async () => {
      const created = await create(
        nfceBody(companyId, { additionalInfo: 'cancelar' }),
        'nfce-cancel-1',
      );
      const id = created.body.data.id as string;
      const justification = 'Pedido cancelado pelo cliente antes da entrega';
      const early = await api('post', `/invoices/${id}/cancel`).send({
        justification,
      });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('ERROR_NFE_INVALID_STATE');
      await db.query(
        `UPDATE "${schema}".nfe_documents SET status = 'authorized', number = 6, series = 1,
           access_key = '35261111222333000181650010000000061123456780', protocol = '135260000000002',
           signed_xml = '<NFe/>', issued_at = now(), authorized_at = now() WHERE id = $1`,
        [id],
      );
      const res = await api('post', `/invoices/${id}/cancel`).send({
        justification,
      });
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        type: 'nfce',
        status: 'cancelling',
      });
      const [outbox] = await db.query(
        `SELECT count(*)::int AS n FROM "${schema}".outbox_messages WHERE aggregate_id = $1 AND type = 'nfe.cancel'`,
        [id],
      );
      expect(outbox.n).toBe(1);
    });
  });
});
