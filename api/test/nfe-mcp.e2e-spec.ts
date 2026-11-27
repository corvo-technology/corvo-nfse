/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies and raw SQL rows are untyped */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import {
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';
import { mcpRpc, mintToken, type MintedToken } from './support/mcp-e2e';

jest.setTimeout(180_000);

/** NF-e through the shared MCP tools (`type: "nfe"`) and the tools that only exist for NF-e. */
const COMPANY_TAX_ID = '11222333000181';
const NFE_ONLY = [
  'nfe_validate',
  'nfe_correct',
  'nfe_inutilize',
  'nfe_number_gaps',
  'nfe_settings_get',
  'nfe_settings_update',
];

/** A consumer sale: no recipient, no natOp. */
const nfceBody = (companyKey: string) => ({
  items: [
    {
      code: companyKey,
      description: 'Café coado',
      ncm: '09012100',
      cfop: '5102',
      unit: 'UN',
      quantity: 1,
      unitPrice: 8,
    },
  ],
  payments: [{ tPag: '17', amount: 8 }],
});

const nfeBody = (companyKey: string) => ({
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
      code: companyKey,
      description: 'Produto de teste',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      quantity: 2,
      unitPrice: 10,
    },
  ],
  payments: [{ tPag: '17', amount: 20 }],
});

describe('MCP tools for NF-e (e2e)', () => {
  let ctx: E2eTestApp;
  let app: INestApplication;
  let db: DataSource;
  let token: MintedToken;
  const companyId = randomUUID();
  const schema = process.env.DB_SCHEMA ?? 'corvo';

  const rpc = (accessToken: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  let seq = 10;
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await rpc(token.accessToken, {
      jsonrpc: '2.0',
      id: seq++,
      method: 'tools/call',
      params: { name, arguments: args },
    }).expect(200);
    const text = (res.body.result.content as Array<{ text: string }>)[0].text;
    return {
      isError: res.body.result.isError === true,
      text,
      json: res.body.result.isError ? null : JSON.parse(text),
    };
  };

  const listedNames = async (): Promise<string[]> => {
    const res = await rpc(token.accessToken, mcpRpc(1, 'tools/list')).expect(
      200,
    );
    return (res.body.result.tools as Array<{ name: string }>).map(
      (t) => t.name,
    );
  };

  const setRelease = async (on: boolean, column = 'nfe_enabled_at') => {
    await db.query(
      `UPDATE "${schema}".tenants SET ${column} = ${on ? 'NOW()' : 'NULL'} WHERE id = $1`,
      [ctx.tenantId],
    );
    await ctx.moduleFixture
      .get<CachePort>(CACHE_PORT)
      .delete(
        `${column === 'nfce_enabled_at' ? 'nfce' : 'nfe'}:enabled:${ctx.tenantId}`,
      );
  };

  beforeAll(async () => {
    ctx = await createSeededE2eApp();
    app = ctx.app;
    db = ctx.dataSource;
    token = await mintToken(app, {
      authUserId: ctx.authUserId,
      tenantId: ctx.tenantId,
      scopes: 'nfse:read nfse:write',
    });
    await db.query(
      `INSERT INTO "${schema}".nfse_companies
         (id, tenant_id, legal_name, tax_id, municipality_code, environment, status,
          address_street, address_number, address_district, address_zip, address_city, address_state,
          created_at, updated_at)
       VALUES ($1, $2, 'Empresa Teste LTDA', $3, '3550308', 'test', 'ready',
          'Avenida Paulista', '1000', 'Bela Vista', '01310100', 'São Paulo', 'SP', NOW(), NOW())`,
      [companyId, ctx.tenantId, COMPANY_TAX_ID],
    );
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  describe('while NF-e is not released', () => {
    it('lists no NF-e-only tool, and the shared ones keep working for NFS-e', async () => {
      const names = await listedNames();
      for (const name of NFE_ONLY) expect(names).not.toContain(name);
      expect(names).toContain('nfse_list');
      const nfse = await call('nfse_list', { limit: 5 });
      expect(nfse.isError).toBe(false);
      expect(nfse.json).toHaveProperty('invoices');
    });

    it('answers that NF-e is not released, for type nfe and for the NF-e-only tools', async () => {
      const shared = await call('nfse_list', { type: 'nfe' });
      expect(shared.isError).toBe(true);
      expect(shared.text).toContain('NF-e não está liberada');
      const only = await call('nfe_settings_get', { company_id: companyId });
      expect(only.isError).toBe(true);
      expect(only.text).toContain('NF-e não está liberada');
    });

    it('type all falls back to the NFS-e list', async () => {
      const all = await call('nfse_list', { type: 'all', limit: 5 });
      expect(all.isError).toBe(false);
      expect(all.json).toHaveProperty('invoices');
    });
  });

  describe('with the tenant released', () => {
    beforeAll(async () => {
      await setRelease(true);
      await db.query(
        `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
         VALUES ('SP', 55, 2, now(), 'docs/fiscal/nfe-runbook.md')
         ON CONFLICT DO NOTHING`,
      );
    });

    it('lists the six NF-e-only tools', async () => {
      const names = await listedNames();
      for (const name of NFE_ONLY) expect(names).toContain(name);
    });

    it('rejects an unknown type before anything runs', async () => {
      const res = await call('nfse_list', { type: 'bogus' });
      expect(res.isError).toBe(true);
      expect(res.text).toContain('type must be one of nfse, nfe, nfce, all');
    });

    it('sets and reads the NF-e settings of the company', async () => {
      const bad = await call('nfe_settings_update', {
        company_id: companyId,
        state_registration: '123',
        crt: 1,
      });
      expect(bad.isError).toBe(true);
      const saved = await call('nfe_settings_update', {
        company_id: companyId,
        state_registration: '110042490114',
        crt: 1,
      });
      expect(saved.isError).toBe(false);
      expect(saved.json).toMatchObject({
        companyId,
        stateRegistration: '110042490114',
        crt: 1,
      });
      const read = await call('nfe_settings_get', { company_id: companyId });
      expect(read.json.missing).toEqual(
        expect.not.arrayContaining(['state_registration']),
      );
    });

    it('nfe_validate is a dry-run: issues and no XML', async () => {
      const ok = await call('nfe_validate', {
        company_id: companyId,
        nfe: nfeBody('SKU1'),
      });
      expect(ok.isError).toBe(false);
      expect(ok.text).not.toContain('<NFe');
      const broken = nfeBody('SKU1');
      broken.items[0].ncm = '1';
      const bad = await call('nfe_validate', {
        company_id: companyId,
        nfe: broken,
      });
      const body = bad.isError ? bad.text : JSON.stringify(bad.json);
      expect(body).toContain('items[0].ncm');
    });

    it('nfse_issue with type nfe needs the idempotency_key, queues the note and nfse_get shows it', async () => {
      const without = await call('nfse_issue', {
        type: 'nfe',
        company_id: companyId,
        nfe: nfeBody('SKU2'),
      });
      expect(without.isError).toBe(true);
      expect(without.text).toContain('idempotency_key');

      const args = {
        type: 'nfe',
        company_id: companyId,
        nfe: nfeBody('SKU2'),
        idempotency_key: `mcp-${randomUUID()}`,
      };
      const issued = await call('nfse_issue', args);
      expect(issued.isError).toBe(false);
      expect(issued.json).toMatchObject({ type: 'nfe' });
      const id = issued.json.invoice_id as string;

      const again = await call('nfse_issue', args);
      expect(again.json).toMatchObject({ invoice_id: id, replayed: true });

      const got = await call('nfse_get', { type: 'nfe', invoice_id: id });
      expect(got.isError).toBe(false);
      expect(got.json.invoice).toMatchObject({ id, type: 'nfe' });
      expect(got.text).not.toContain('signedXml');
      expect(got.text).not.toContain('<NFe');

      const listed = await call('nfse_list', { type: 'nfe', limit: 10 });
      expect(listed.json.invoices.map((i: { id: string }) => i.id)).toContain(
        id,
      );
      expect(listed.text).not.toContain('12345678909');

      const all = await call('nfse_list', { type: 'all', limit: 10 });
      expect(
        all.json.invoices.find((i: { id: string }) => i.id === id),
      ).toMatchObject({ type: 'nfe' });
    });

    it('nfe_number_gaps answers a list', async () => {
      const gaps = await call('nfe_number_gaps', { company_id: companyId });
      expect(gaps.isError).toBe(false);
      expect(Array.isArray(gaps.json.gaps)).toBe(true);
    });

    it('nfse_cancel with type nfe on a note that is not authorized is refused with a readable code', async () => {
      const issued = await call('nfse_issue', {
        type: 'nfe',
        company_id: companyId,
        nfe: nfeBody('SKU3'),
        idempotency_key: `mcp-${randomUUID()}`,
      });
      const res = await call('nfse_cancel', {
        type: 'nfe',
        invoice_id: issued.json.invoice_id,
        description: 'cancelamento de teste pelo agente',
      });
      expect(res.isError).toBe(true);
      expect(res.text.length).toBeGreaterThan(0);
    });

    it('while NFC-e is not released, type nfce says so and NF-e keeps working', async () => {
      const res = await call('nfse_list', { type: 'nfce' });
      expect(res.isError).toBe(true);
      expect(res.text).toContain('NFC-e não está liberada');
      const nfe = await call('nfse_list', { type: 'nfe', limit: 5 });
      expect(nfe.isError).toBe(false);
    });

    it('turning the release off hides the tools again', async () => {
      await setRelease(false);
      const names = await listedNames();
      for (const name of NFE_ONLY) expect(names).not.toContain(name);
      await setRelease(true);
    });
  });

  describe('NFC-e released (type nfce)', () => {
    beforeAll(async () => {
      await setRelease(true);
      await setRelease(true, 'nfce_enabled_at');
      await db.query(
        `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
         VALUES ('SP', 65, 2, now(), 'docs/fiscal/runbooks/nfce-homologacao.md')
         ON CONFLICT DO NOTHING`,
      );
    });

    afterAll(async () => {
      await setRelease(false, 'nfce_enabled_at');
      await setRelease(false);
    });

    it('with only NFC-e released the shared NF-e/NFC-e tools are listed, nfe_correct is not', async () => {
      await setRelease(false);
      const names = await listedNames();
      expect(names).toContain('nfe_validate');
      expect(names).toContain('nfe_settings_get');
      expect(names).not.toContain('nfe_correct');
      await setRelease(true);
      expect(await listedNames()).toContain('nfe_correct');
    });

    it('nfe_validate with type nfce is a dry-run and shows no XML', async () => {
      const ok = await call('nfe_validate', {
        company_id: companyId,
        type: 'nfce',
        nfe: nfceBody('CAFE1'),
      });
      expect(ok.isError).toBe(false);
      expect(ok.text).not.toContain('<NFe');
    });

    it('issues a NFC-e, reads it back, lists it, and cannot correct it', async () => {
      const args = {
        type: 'nfce',
        company_id: companyId,
        nfe: nfceBody('CAFE2'),
        idempotency_key: `mcp-${randomUUID()}`,
      };
      const issued = await call('nfse_issue', args);
      expect(issued.isError).toBe(false);
      expect(issued.json).toMatchObject({ type: 'nfce' });
      const id = issued.json.invoice_id as string;
      expect((await call('nfse_issue', args)).json).toMatchObject({
        invoice_id: id,
        replayed: true,
      });

      const got = await call('nfse_get', { type: 'nfce', invoice_id: id });
      expect(got.isError).toBe(false);
      expect(got.json.invoice).toMatchObject({ id, type: 'nfce' });
      expect(got.text).not.toContain('signedXml');

      // an NF-e id is not a NFC-e: each type only sees its own documents
      const wrong = await call('nfse_get', { type: 'nfe', invoice_id: id });
      expect(wrong.isError).toBe(true);

      const listed = await call('nfse_list', { type: 'nfce', limit: 10 });
      expect(listed.json.invoices.map((i: { id: string }) => i.id)).toContain(
        id,
      );
      const all = await call('nfse_list', { type: 'all', limit: 20 });
      expect(
        all.json.invoices.find((i: { id: string }) => i.id === id),
      ).toMatchObject({ type: 'nfce' });

      const correct = await call('nfe_correct', {
        invoice_id: id,
        correction: 'corrigir o endereço de entrega',
      });
      expect(correct.isError).toBe(true);
      expect(correct.text).toContain('INVOICE_OPERATION_NOT_SUPPORTED');
    });

    it('nfe_number_gaps and nfe_settings take the NFC-e model and series', async () => {
      const gaps = await call('nfe_number_gaps', {
        company_id: companyId,
        model: 65,
      });
      expect(gaps.isError).toBe(false);
      const saved = await call('nfe_settings_update', {
        company_id: companyId,
        state_registration: '110042490114',
        crt: 1,
        nfce_default_series: 2,
      });
      expect(saved.isError).toBe(false);
      expect(saved.json).toMatchObject({ nfceDefaultSeries: 2 });
    });
  });
});
