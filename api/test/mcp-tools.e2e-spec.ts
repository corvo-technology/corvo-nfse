/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createSeededE2eApp,
  closeE2eApp,
  type E2eTestApp,
} from './support/e2e-app';
import { AuthOAuthClientOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { McpConnectionOrmEntity } from '@/modules/mcp/infra/mcp-connection.orm-entity';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import {
  MCP_REDIRECT_URI,
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
    // A second client: the same client would reuse (and re-scope) the connection above.
    await dataSource.getRepository(AuthOAuthClientOrmEntity).insert({
      id: 'corvo-mcp-readonly00001',
      name: 'Read only e2e',
      redirectUris: [MCP_REDIRECT_URI],
      scopes: ['nfse:read'],
      isFirstParty: false,
      isActive: true,
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code'],
    });
    readOnlyToken = await mintToken(app, {
      authUserId,
      tenantId,
      scopes: 'nfse:read',
      clientId: 'corvo-mcp-readonly00001',
    });
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('lists the tools with real input schemas, including nfse_issue_batch', async () => {
    const res = await mcpPost(
      fullToken.accessToken,
      mcpRpc(1, 'tools/list'),
    ).expect(200);

    const tools = res.body.result.tools as Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'company_list',
        'nfse_cancel',
        'nfse_download_pdf',
        'nfse_issue',
        'nfse_issue_batch',
        'nfse_list',
        'nfse_query',
        'nfse_repeat',
        'nfse_email_resend',
        'company_update',
        'accountant_package_send',
        'service_favorite_list',
        'service_favorite_create',
        'service_favorite_delete',
        'product_favorite_list',
        'product_favorite_create',
        'product_favorite_delete',
        'invoices_overview',
        'credits_balance',
        'nfse_get',
        'company_fiscal_status',
        'company_numbering_check',
        'cnpj_lookup',
      ]),
    );
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

    const content = res.body.result.content as Array<{
      type: string;
      text: string;
    }>;
    expect(res.body.result.isError).toBe(true);
    expect(content[0].text).toContain(
      'Criar empresas, emitir e cancelar notas fiscais',
    );
  });

  it('nfse_query returns an error result for an unknown access key', async () => {
    const res = await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'nfse_query',
        arguments: { access_key: '99999999999999999999' },
      },
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

  it('a live connection works in the live environment and cannot see test companies', async () => {
    await dataSource.getRepository(AuthOAuthClientOrmEntity).insert({
      id: 'corvo-mcp-liveagent00001',
      name: 'Live e2e',
      redirectUris: [MCP_REDIRECT_URI],
      scopes: ['nfse:read', 'nfse:write'],
      isFirstParty: false,
      isActive: true,
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code'],
    });
    const live = await mintToken(app, {
      authUserId,
      tenantId,
      scopes: 'nfse:read nfse:write',
      clientId: 'corvo-mcp-liveagent00001',
      environment: 'live',
    });

    const list = await mcpPost(live.accessToken, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'nfse_list', arguments: { limit: 5 } },
    }).expect(200);
    expect(list.body.result.isError).toBeUndefined();

    // The company seeded below is a test-environment company: live must not resolve it.
    await dataSource.query(
      `INSERT INTO "${schema}"."nfse_companies"
         (id, tenant_id, legal_name, tax_id, municipality_code,
          municipal_reg, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        'aaaaaaaa-1111-4222-8333-444444444444',
        tenantId,
        'Empresa MCP E2E',
        COMPANY_TAX_ID,
      ],
    );
    const issue = await mcpPost(live.accessToken, {
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'nfse_issue',
        arguments: {
          company_id: 'aaaaaaaa-1111-4222-8333-444444444444',
          customer: { name: 'Cliente', tax_id: CUSTOMER_TAX_ID },
          services: [{ description: 'Servico', quantity: 1, unit_price: 10 }],
          competence_date: COMPETENCE_DATE,
        },
      },
    }).expect(200);
    expect(issue.body.result.isError).toBe(true);
  });

  it('counts successful tool calls (and not failed ones) on the connection', async () => {
    const repo = dataSource.getRepository(McpConnectionOrmEntity);
    const before = await repo.findOneOrFail({
      where: { id: fullToken.connectionId },
    });

    await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'nfse_list', arguments: { limit: 5 } },
    }).expect(200);
    await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'nfse_query', arguments: { access_key: '1'.repeat(20) } },
    }).expect(200);

    const after = await repo.findOneOrFail({
      where: { id: fullToken.connectionId },
    });
    expect(after.toolCallsCount).toBe(before.toolCallsCount + 1);
    expect(after.invoicesIssuedCount).toBe(before.invoicesIssuedCount);
    expect(after.lastUsedAt).toBeTruthy();
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
          services: [
            { description: 'Consultoria', quantity: 1, unit_price: 100 },
          ],
          competence_date: COMPETENCE_DATE,
          service_code: '010101',
          municipality_code: '3550308',
        },
      },
    }).expect(200);

    // The invoice row is persisted by the lifecycle before the BullMQ enqueue,
    // so it should exist for this tenant even if the queue is unavailable.
    const row = await dataSource.getRepository(InvoiceOrmEntity).findOne({
      where: { tenantId, companyId },
      order: { createdAt: 'DESC' },
    });
    expect(row).toBeTruthy();
    expect(row!.status).toBe('queued');
    expect(row!.environment).toBe('test');
  });
  it('company_list finds the company and nfse_issue works with just its CNPJ and an amount', async () => {
    const companyId = 'bbbbbbbb-1111-4222-8333-444444444444';
    const taxId = '45723174000110';
    await dataSource.query(
      `INSERT INTO "${schema}"."nfse_companies"
         (id, tenant_id, legal_name, tax_id, municipality_code,
          municipal_reg, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, tenantId, 'Empresa Simples E2E', taxId],
    );

    const listed = await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'company_list',
        arguments: { tax_id: '45.723.174/0001-10' },
      },
    }).expect(200);
    expect(listed.body.result.isError).not.toBe(true);
    const payload = JSON.parse(listed.body.result.content[0].text) as {
      companies: Array<{ id: string; tax_id: string; setup_gaps: string[] }>;
    };
    expect(payload.companies).toHaveLength(1);
    expect(payload.companies[0]).toMatchObject({
      id: companyId,
      tax_id: taxId,
    });

    const issued = await mcpPost(fullToken.accessToken, {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'nfse_issue',
        arguments: {
          company_tax_id: taxId,
          amount: 1,
          description: 'Servico de teste',
          competence_date: COMPETENCE_DATE,
          service_code: '010101',
          municipality_code: '3550308',
        },
      },
    }).expect(200);
    expect(issued.body.result.isError).not.toBe(true);

    const row = await dataSource.getRepository(InvoiceOrmEntity).findOne({
      where: { tenantId, companyId },
      order: { createdAt: 'DESC' },
    });
    expect(row).toBeTruthy();
    expect(row!.status).toBe('queued');
  });

  it('nfse_issue_batch saves the valid rows, rejects the invalid one in place and replays on retry', async () => {
    const companyId = 'cccccccc-1111-4222-8333-444444444444';
    const taxId = '11222333000262';
    await dataSource.query(
      `INSERT INTO "${schema}"."nfse_companies"
         (id, tenant_id, legal_name, tax_id, municipality_code,
          municipal_reg, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, tenantId, 'Empresa Lote E2E', taxId],
    );
    const call = () =>
      mcpPost(fullToken.accessToken, {
        jsonrpc: '2.0',
        id: 60,
        method: 'tools/call',
        params: {
          name: 'nfse_issue_batch',
          arguments: {
            invoices: [
              {
                company_tax_id: taxId,
                amount: 10,
                competence_date: COMPETENCE_DATE,
                service_code: '010101',
                municipality_code: '3550308',
                idempotency_key: 'e2e-batch-row-1',
              },
              { company_tax_id: taxId, amount: 'not a number' },
              {
                company_tax_id: taxId,
                amount: 20,
                competence_date: COMPETENCE_DATE,
                service_code: '010101',
                municipality_code: '3550308',
                idempotency_key: 'e2e-batch-row-3',
              },
            ],
          },
        },
      }).expect(200);
    type Payload = {
      total: number;
      accepted: number;
      rejected: number;
      results: Array<{
        index: number;
        status: string;
        replayed?: boolean;
        invoice_id?: string;
        error?: { code: string };
      }>;
    };
    const payload = (res: { body: any }) =>
      JSON.parse(res.body.result.content[0].text) as Payload;

    const first = payload(await call());
    expect(first).toMatchObject({ total: 3, accepted: 2, rejected: 1 });
    expect(first.results.map((r) => [r.index, r.status])).toEqual([
      [0, 'accepted'],
      [1, 'rejected'],
      [2, 'accepted'],
    ]);
    expect(first.results[1]?.error?.code).toBe('ERROR_VALIDATION');
    const saved = await dataSource
      .getRepository(InvoiceOrmEntity)
      .count({ where: { tenantId, companyId } });
    expect(saved).toBe(2);

    const retry = payload(await call());
    expect(retry.results[0]).toMatchObject({
      status: 'accepted',
      replayed: true,
      invoice_id: first.results[0]?.invoice_id,
    });
    expect(
      await dataSource
        .getRepository(InvoiceOrmEntity)
        .count({ where: { tenantId, companyId } }),
    ).toBe(2);
  });
});
