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

/** `POST /v1/invoices/validate` with `type: "nfce"` (the dry-run) against the real app and database. */
const COMPANY_TAX_ID = '11222333000181';

const body = (overrides: Record<string, unknown> = {}) => ({
  companyId: '',
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

describe('POST /v1/invoices/validate with type nfce (e2e)', () => {
  let ctx: E2eTestApp;
  let db: DataSource;
  let tenantId: string;
  let key: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();

  const validate = (payload: unknown, query = '') =>
    request(ctx.app.getHttpServer())
      .post(`/v1/invoices/validate${query}`)
      .set(apiKeyHeader(key))
      .send({ type: 'nfce', ...(payload as object) });

  const count = async (table: string): Promise<number> => {
    const rows: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM "${schema}".${table} WHERE tenant_id = $1`,
      [tenantId],
    );
    return Number(rows[0].n);
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
       VALUES ($1, $2, 'e2e-nfce', 'test', $3, $4, 'full_access', NOW())`,
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

  it('answers 404 while the tenant has no NFC-e release', async () => {
    const res = await validate(body({ companyId }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ERROR_RESOURCE_NOT_FOUND');
  });

  it('a release of the NF-e alone does not open the NFC-e', async () => {
    await db.query(
      `UPDATE "${schema}".tenants SET nfe_enabled_at = NOW() WHERE id = $1`,
      [tenantId],
    );
    await dropCache();
    const res = await validate(body({ companyId }));
    expect(res.status).toBe(404);
  });

  describe('with the NFC-e released', () => {
    beforeAll(async () => {
      await db.query(
        `UPDATE "${schema}".tenants SET nfce_enabled_at = NOW() WHERE id = $1`,
        [tenantId],
      );
      await dropCache();
    });

    it('answers 422 COMPANY_NFE_INCOMPLETE while the company has no IE', async () => {
      const res = await validate(body({ companyId }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'ERROR_COMPANY_NFE_INCOMPLETE',
        type: 'configuration',
      });
    });

    it('answers 422 UF_NOT_ENABLED while the UF has no model 65 row', async () => {
      await request(ctx.app.getHttpServer())
        .put(`/v1/companies/${companyId}/nfe-settings`)
        .set(apiKeyHeader(key))
        .send({ stateRegistration: '110042490114', crt: 1 })
        .expect(200);
      // A model 55 row does not release the NFC-e.
      await db.query(
        `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
         VALUES ('SP', 55, 2, now(), 'docs/fiscal/nfe-runbook.md')`,
      );
      const res = await validate(body({ companyId }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'ERROR_UF_NOT_ENABLED',
        type: 'configuration',
      });
      expect(await count('nfe_number_sequences')).toBe(0);
    });

    describe('with the UF released for model 65', () => {
      beforeAll(async () => {
        await db.query(
          `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
           VALUES ('SP', 65, 2, now(), 'docs/fiscal/nfe-runbook.md')`,
        );
      });

      it('answers 200 with a model 65 key preview, and saves nothing', async () => {
        const res = await validate(body({ companyId }));
        expect(res.status).toBe(200);
        expect(res.body.data.valid).toBe(true);
        const keyPreview: string = res.body.data.accessKeyPreview;
        expect(keyPreview).toMatch(/^35\d{42}$/);
        expect(keyPreview.slice(6, 20)).toBe(COMPANY_TAX_ID);
        expect(keyPreview.slice(20, 22)).toBe('65');
        expect(res.body.data.xml).toBeUndefined();
        expect(await count('nfe_documents')).toBe(0);
        expect(await count('nfe_number_sequences')).toBe(0);
      });

      it('returns the preview XML with the QR Code only when asked', async () => {
        const res = await validate(body({ companyId }), '?includeXml=true');
        expect(res.status).toBe(200);
        expect(res.body.data.xml).toContain('<mod>65</mod>');
        expect(res.body.data.xml).toContain('<infNFeSupl><qrCode>');
        expect(res.body.data.xml).toContain(
          `${res.body.data.accessKeyPreview}|3|2</qrCode>`,
        );
        expect(res.body.data.xml).not.toContain('<dest>');
      });

      it('uses the NFC-e series and numbering, not the NF-e ones', async () => {
        await db.query(
          `INSERT INTO "${schema}".nfe_number_sequences (tenant_id, company_id, model, series, current_number)
           VALUES ($1, $2, 55, 1, 100), ($1, $2, 65, 1, 41)`,
          [tenantId, companyId],
        );
        const res = await validate(body({ companyId }), '?includeXml=true');
        expect(res.body.data.xml).toContain('<nNF>42</nNF>');
      });

      it('answers 422 NFCE_CONSUMER_ID_REQUIRED at R$ 10.000,00 without CPF (Review Focus 5)', async () => {
        const payload = body({ companyId });
        const res = await validate({
          ...payload,
          items: [{ ...payload.items[0], quantity: 1, unitPrice: 10000 }],
          payments: [{ tPag: '01', amount: 10000 }],
        });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({
          code: 'ERROR_NFE_VALIDATION_FAILED',
          type: 'validation',
        });
        expect(res.body.details).toEqual([
          expect.objectContaining({
            field: 'recipient.taxId',
            code: 'ERROR_NFCE_CONSUMER_ID_REQUIRED',
          }),
        ]);
      });

      it('answers 200 at R$ 9.999,99 without CPF', async () => {
        const payload = body({ companyId });
        const res = await validate({
          ...payload,
          items: [{ ...payload.items[0], quantity: 1, unitPrice: 9999.99 }],
          payments: [{ tPag: '01', amount: 9999.99 }],
        });
        expect(res.status).toBe(200);
      });

      it('answers 422 NFCE_DELIVERY_ADDRESS_REQUIRED for indPres 4 without address, before numbering', async () => {
        const res = await validate({
          ...body({ companyId }),
          indPres: 4,
          recipient: { taxId: '123.456.789-09', name: 'Maria' },
        });
        expect(res.status).toBe(422);
        expect(res.body.details).toEqual([
          expect.objectContaining({
            field: 'recipient',
            code: 'ERROR_NFCE_DELIVERY_ADDRESS_REQUIRED',
          }),
        ]);
      });

      it('refuses fields the NFC-e does not have (natOp, finNfe, transport) with 400', async () => {
        for (const extra of [
          { natOp: 'Venda' },
          { finNfe: 2 },
          { transport: { modFrete: 1 } },
        ]) {
          const res = await validate({ ...body({ companyId }), ...extra });
          expect(res.status).toBe(400);
        }
      });

      it('accepts a card payment and a CPF consumer', async () => {
        const res = await validate({
          ...body({ companyId }),
          recipient: { taxId: '123.456.789-09' },
          payments: [
            {
              tPag: '03',
              amount: 20,
              card: {
                tpIntegra: 1,
                cnpj: '11222333000181',
                tBand: '01',
                cAut: 'A1B2C3',
              },
            },
          ],
        });
        expect(res.status).toBe(200);
      });
    });

    it('create with type nfce answers 422 INVOICE_OPERATION_NOT_SUPPORTED for now', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/v1/invoices')
        .set(apiKeyHeader(key))
        .set('Idempotency-Key', randomUUID())
        .send({ type: 'nfce', ...body({ companyId }) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ERROR_INVOICE_OPERATION_NOT_SUPPORTED');
    });
  });
});
