import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createSeededE2eApp,
  closeE2eApp,
  type E2eTestApp,
} from './support/e2e-app';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import {
  mintToken,
  mcpRpc,
  type MintedToken,
} from './support/mcp-e2e';

jest.setTimeout(180_000);

// Valid fiscal fixtures reused from fiscal-environments.e2e-spec.ts.
const COMPANY_TAX_ID = '11222333000181'; // CNPJ
const CUSTOMER_TAX_ID = '52998224725'; // CPF
const COMPETENCE_DATE = '2026-09-01';

describe('MCP tools (JSON-RPC over POST /v1/mcp) (e2e)', () => {
  let ctx: E2eTestApp;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;
  let authUserId: string;
  let fullToken: MintedToken;
  let readOnlyToken: MintedToken;

  const schema = process.env.DB_SCHEMA ?? 'corvo';

  const mcpPost = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    ctx = await createSeededE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    tenantId = ctx.tenantId;
    authUserId = ctx.authUserId;

    fullToken = await mintToken(app, {
      authUserId,
      tenantId,
      scopes: 'nfse:read nfse:write',
    });
    readOnlyToken = await mintToken(app, {
      authUserId,
      tenantId,
      scopes: 'nfse:read',
    });
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('lists 4 tools with real input schemas', async () => {
    const res = await mcpPost(fullToken.accessToken, mcpRpc(1, 'tools/list'))
      .expect(200);

    const tools = res.body.result.tools as Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'nfse_download_pdf',
      'nfse_issue',
      'nfse_list',
      'nfse_query',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('rejects a request with an invalid/unknown token with 401', async () => {
    await request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(mcpRpc(1, 'tools/list'))
      .expect(401);
  });

  it('rejects a request with no Authorization header with 401', async () => {
    await request(app.getHttpServer())
      .post('/v1/mcp')
      .send(mcpRpc(1, 'tools/list'))
      .expect(401);
  });

  it('enforces scopes: nfse:read token cannot call nfse_issue', async () => {
    const res = await mcpPost(readOnlyToken.accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'nfse_issue',
        arguments: {
          company_id: '00000000-0000-0000-0000-000000000000',
          customer: { name: 'X', tax_id: CUSTOMER_TAX_ID },
          services: [{ description: 'Y', quantity: 1, unit_price: 1 }],
          competence_date: COMPETENCE_DATE,
        },
      },
    }).expect(200);

    const content = res.body.result.content as Array<{ type: string; text: string }>;
    expect(res.body.result.isError).toBe(true);
    expect(content[0].text).toContain('nfse:write');
  });

  it('nfse_query returns an error result for an unknown access key', async () => {
    const res = await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'nfse_query', arguments: { access_key: '99999999999999999999' } },
    }).expect(200);

    expect(res.body.result.isError).toBe(true);
    const content = res.body.result.content as Array<{ text: string }>;
    expect(content[0].text).toContain('Invoice not found');
  });

  it('nfse_list returns the { invoices, next_cursor } shape', async () => {
    const res = await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nfse_list', arguments: { limit: 20 } },
    }).expect(200);

    const payload = JSON.parse(
      (res.body.result.content as Array<{ text: string }>)[0].text,
    ) as { invoices: unknown[]; next_cursor: string | null };
    expect(Array.isArray(payload.invoices)).toBe(true);
    expect(payload).toHaveProperty('next_cursor');
  });

  it('nfse_issue queues an invoice persisted to nfse_invoices', async () => {
    // Seed a test-environment company so the issue handler can resolve it.
    const companyId = 'aaaaaaaa-1111-4222-8333-444444444444';
    await dataSource.query(
      `INSERT INTO "${schema}"."nfse_companies"
         (id, tenant_id, legal_name, tax_id, municipality_code,
          municipal_reg, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, tenantId, 'Empresa MCP E2E', COMPANY_TAX_ID],
    );

    await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'nfse_issue',
        arguments: {
          company_id: companyId,
          customer: {
            name: 'Cliente E2E',
            tax_id: CUSTOMER_TAX_ID,
            email: 'cliente@e2e.invalid',
          },
          services: [{ description: 'Consultoria', quantity: 1, unit_price: 100 }],
          competence_date: COMPETENCE_DATE,
          service_code: '010101',
          municipality_code: '3550308',
        },
      },
    }).expect(200);

    // The invoice row is persisted by the lifecycle before the BullMQ enqueue,
    // so it should exist for this tenant even if the queue is unavailable.
    const row = await dataSource
      .getRepository(InvoiceOrmEntity)
      .findOne({ where: { tenantId, companyId }, order: { createdAt: 'DESC' } });
    expect(row).toBeTruthy();
    expect(row!.status).toBe('queued');
    expect(row!.environment).toBe('test');
  });
});
