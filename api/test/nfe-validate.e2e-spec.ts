/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies and raw SQL rows are untyped */
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

/** `POST /v1/nfe/validate` (the dry-run) against the real app and database. */
const COMPANY_TAX_ID = '11222333000181';

const body = (overrides: Record<string, unknown> = {}) => ({
  companyId: '',
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

describe('POST /v1/nfe/validate (e2e)', () => {
  let ctx: E2eTestApp;
  let db: DataSource;
  let tenantId: string;
  let key: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();

  const validate = (payload: unknown, query = '') =>
    request(ctx.app.getHttpServer())
      .post(`/v1/nfe/validate${query}`)
      .set(apiKeyHeader(key))
      .send(payload as object);

  const count = async (table: string): Promise<number> => {
    const rows: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM "${schema}".${table} WHERE tenant_id = $1`,
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
       VALUES ($1, $2, 'e2e-nfe', 'test', $3, $4, 'full_access', NOW())`,
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

  it('answers 404 while the tenant is not released', async () => {
    const res = await validate(body({ companyId }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ERROR_RESOURCE_NOT_FOUND');
  });

  describe('with the tenant released', () => {
    beforeAll(async () => {
      await db.query(
        `UPDATE "${schema}".tenants SET nfe_enabled_at = NOW() WHERE id = $1`,
        [tenantId],
      );
      // The 404 above was cached for a minute.
      await ctx.moduleFixture
        .get<CachePort>(CACHE_PORT)
        .delete(`nfe:enabled:${tenantId}`);
    });

    it('answers 422 COMPANY_NFE_INCOMPLETE while the company has no IE and CRT', async () => {
      const res = await validate(body({ companyId }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'ERROR_COMPANY_NFE_INCOMPLETE',
        type: 'configuration',
      });
      expect(res.body.details.map((d: any) => d.field)).toEqual(
        expect.arrayContaining(['state_registration', 'crt']),
      );
    });

    it('answers 422 UF_NOT_ENABLED while the UF has no row, before anything is numbered', async () => {
      await request(ctx.app.getHttpServer())
        .put(`/v1/companies/${companyId}/nfe-settings`)
        .set(apiKeyHeader(key))
        .send({ stateRegistration: '110042490114', crt: 1 })
        .expect(200);
      const res = await validate(body({ companyId }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'ERROR_UF_NOT_ENABLED',
        type: 'configuration',
      });
      expect(await count('nfe_number_sequences')).toBe(0);
    });

    describe('with the UF released', () => {
      beforeAll(async () => {
        await db.query(
          `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
           VALUES ('SP', 55, 2, now(), 'docs/fiscal/nfe-runbook.md')`,
        );
      });

      it('answers 200 with the preview key, and saves nothing', async () => {
        const res = await validate(body({ companyId }));
        expect(res.status).toBe(200);
        expect(res.body.data.valid).toBe(true);
        expect(res.body.data.accessKeyPreview).toMatch(/^35\d{42}$/);
        expect(res.body.data.accessKeyPreview.slice(6, 20)).toBe(
          COMPANY_TAX_ID,
        );
        expect(res.body.data.xml).toBeUndefined();
        expect(await count('nfe_documents')).toBe(0);
        expect(await count('nfe_number_sequences')).toBe(0);
      });

      it('returns the preview XML only when asked', async () => {
        const res = await validate(body({ companyId }), '?includeXml=true');
        expect(res.status).toBe(200);
        expect(res.body.data.xml).toContain('<infNFe versao="4.00"');
        expect(res.body.data.xml).toContain('<nNF>1</nNF>');
        expect(res.body.data.xml).not.toContain('maria@example.com'.repeat(2));
      });

      it('uses current_number + 1 for the preview without reserving it', async () => {
        await db.query(
          `INSERT INTO "${schema}".nfe_number_sequences (tenant_id, company_id, model, series, current_number)
           VALUES ($1, $2, 55, 1, 41)`,
          [tenantId, companyId],
        );
        const res = await validate(body({ companyId }), '?includeXml=true');
        expect(res.body.data.xml).toContain('<nNF>42</nNF>');
        const rows: Array<{ current_number: number }> = await db.query(
          `SELECT current_number FROM "${schema}".nfe_number_sequences WHERE company_id = $1`,
          [companyId],
        );
        expect(rows[0].current_number).toBe(41);
      });

      it('answers 422 with every problem at once: bad NCM and wrong payment', async () => {
        const payload = body({ companyId });
        const res = await validate({
          ...payload,
          items: [{ ...payload.items[0], ncm: '1234567' }],
          payments: [{ tPag: '17', amount: 5 }],
        });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({
          code: 'ERROR_NFE_VALIDATION_FAILED',
          type: 'validation',
        });
        expect(res.body.details.map((d: any) => [d.field, d.code])).toEqual([
          ['items[0].ncm', 'ERROR_NCM_INVALID'],
          ['payments', 'ERROR_PAYMENTS_TOTAL_MISMATCH'],
        ]);
        expect(await count('nfe_documents')).toBe(0);
      });

      it('names the field of an emoji instead of letting the SEFAZ reject it', async () => {
        const payload = body({ companyId });
        const res = await validate({
          ...payload,
          items: [{ ...payload.items[0], description: 'Caneca 😀' }],
        });
        expect(res.status).toBe(422);
        expect(res.body.details).toEqual([
          expect.objectContaining({
            field: 'items[0].description',
            code: 'ERROR_TEXT_CHARSET_INVALID',
          }),
        ]);
      });
    });
  });
});
