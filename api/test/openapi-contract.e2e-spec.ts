/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- supertest bodies and raw SQL rows are untyped; node-forge ships no types */
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import * as argon2 from 'argon2';
import * as forge from 'node-forge';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { SimplesRegistryPort } from '@/modules/company/domain/registry-check';
import { ImportReaderService } from '@/modules/import/application/import-reader.service';
import { ImportFileStorage } from '@/modules/import/infra/import-file-storage';
import { DOCUMENT_STORAGE } from '@/infra/storage/domain/document-storage';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';
import {
  allOperations,
  contractProblems,
  documentedOperation,
} from './support/openapi-contract';

/**
 * The published contract (docs/openapi/openapi.json) against the real API.
 *
 * Each case calls a route of the running app (real Nest pipeline, interceptors
 * and database) and checks the answer against the response schema, status code
 * and media type the contract documents for that operation. A contract that
 * drifts from the controllers (a missing `{ data }` envelope, a 201 documented
 * as 200, a list without `pagination`) fails here.
 */
const COMPANY_TAX_ID = '11222333000181';
const CUSTOMER_TAX_ID = '52998224725';
const ZONE = 'America/Sao_Paulo';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

function collect(
  res: NodeJS.ReadableStream & {
    on: (event: string, callback: (...args: any[]) => void) => unknown;
  },
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('OpenAPI contract against the real API (e2e)', () => {
  let ctx: E2eTestApp;
  let dataSource: DataSource;
  let tenantId: string;
  let testKey: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();
  const covered = new Set<string>();
  const problems: string[] = [];
  const documents = new Map<string, Buffer | string>();
  const ids: Record<string, string> = {};
  const inDays = (days: number) =>
    DateTime.now().setZone(ZONE).plus({ days }).toISODate()!;
  const today = DateTime.now().setZone(ZONE).toISODate()!;

  const invoiceBody = (extra: Record<string, unknown> = {}) => ({
    companyTaxId: COMPANY_TAX_ID,
    customer: { name: 'Cliente', taxId: CUSTOMER_TAX_ID },
    service: { description: 'Consultoria', code: '010101' },
    amount: 100,
    competenceDate: today,
    ...extra,
  });

  /** Calls the route, checks the answer against the contract and hands it back. */
  async function call(
    key: string,
    options: {
      path?: string;
      query?: Record<string, string | number>;
      body?: unknown;
      /** `multipart/form-data` fields and the file. */
      attach?: { field: string; content: Buffer; name: string };
      fields?: Record<string, string>;
      status?: number;
      headers?: Record<string, string>;
    } = {},
  ) {
    documentedOperation(key); // the case names a documented operation
    const [verb, template] = key.split(' ');
    const method = verb.toLowerCase() as Method;
    const path = options.path ?? template;
    let req = request(ctx.app.getHttpServer())
      [method](`/v1${path}`)
      .set(apiKeyHeader(testKey))
      .set(options.headers ?? {})
      .buffer(true)
      .parse(collect as never);
    if (options.query) req = req.query(options.query);
    if (options.attach) {
      req = req.attach(options.attach.field, options.attach.content, {
        filename: options.attach.name,
      });
      for (const [name, value] of Object.entries(options.fields ?? {}))
        req = req.field(name, value);
    } else if (options.body !== undefined)
      req = req.send(options.body as object);
    const res = await req;
    const raw = res.body as Buffer;
    const text = raw.toString('utf8');
    const contentType = String(res.headers['content-type'] ?? '');
    const body: unknown =
      contentType.includes('json') && text ? JSON.parse(text) : text;
    const real = { status: res.status, contentType, body, text };
    if (options.status !== undefined && res.status !== options.status)
      throw new Error(
        `${key}: expected ${options.status}, got ${res.status}: ${text.slice(0, 300)}`,
      );
    // Recorded, not thrown: the cases that follow need this answer's ids. The last test fails on any.
    const found = contractProblems(key, real);
    problems.push(...found);
    covered.add(key);
    return real as typeof real & { body: any };
  }

  beforeAll(async () => {
    ctx = await createSeededE2eApp((builder) =>
      builder
        .overrideProvider(SimplesRegistryPort)
        .useValue({
          // The public CNPJ registry is an outside service: answer from memory.
          lookup: () =>
            Promise.resolve({
              optanteSimples: false,
              optanteMei: false,
              municipalityCode: '3550308',
            }),
          lookupProfile: () =>
            Promise.resolve({
              status: 'found',
              profile: {
                legalName: 'Empresa Teste',
                tradeName: '',
                address: {
                  zip: '01001000',
                  street: 'Praça da Sé',
                  number: '1',
                  complement: '',
                  district: 'Sé',
                  city: 'São Paulo',
                  state: 'SP',
                },
                municipalityCode: '3550308',
                simples: true,
                mei: false,
                active: true,
                situation: 'ATIVA',
              },
            }),
        })
        .overrideProvider(ImportFileStorage)
        .useValue({
          save: (t: string, e: string, id: string, bytes: Buffer) =>
            Promise.resolve(
              void documents.set(`import/${t}/${e}/${id}`, bytes),
            ),
          read: (t: string, e: string, id: string) =>
            Promise.resolve(documents.get(`import/${t}/${e}/${id}`) as Buffer),
          remove: (t: string, e: string, id: string) =>
            Promise.resolve(void documents.delete(`import/${t}/${e}/${id}`)),
        })
        .overrideProvider(getQueueToken('import-read'))
        .useValue({ add: () => Promise.resolve() })
        .overrideProvider(getQueueToken('import-emit'))
        .useValue({ add: () => Promise.resolve() })
        .overrideProvider(DOCUMENT_STORAGE)
        .useValue({
          saveXml: (t: string, i: string, xml: string) =>
            Promise.resolve(void documents.set(`${t}/${i}.xml`, xml)),
          getXml: (t: string, i: string) =>
            Promise.resolve(documents.get(`${t}/${i}.xml`) as string),
          savePdf: (t: string, i: string, pdf: Buffer) =>
            Promise.resolve(void documents.set(`${t}/${i}.pdf`, pdf)),
          getPdf: (t: string, i: string) =>
            Promise.resolve(documents.get(`${t}/${i}.pdf`) as Buffer),
          exists: (t: string, i: string, format: string) =>
            Promise.resolve(documents.has(`${t}/${i}.${format}`)),
          getSignedUrl: (_t: string, i: string, format: string) =>
            Promise.resolve({
              url: `https://files.example/${i}.${format}`,
              expiresAt: new Date(Date.now() + 60_000),
              fileName: `nfse.${format}`,
              mimeType:
                format === 'pdf' ? 'application/pdf' : 'application/xml',
            }),
        }),
    );
    dataSource = ctx.dataSource;
    tenantId = ctx.tenantId;
    const tokenHex = randomBytes(20).toString('hex');
    testKey = `corvo_test_${tokenHex}`;
    await dataSource.query(
      `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
       VALUES ($1, $2, 'e2e-contract', 'test', $3, $4, 'full_access', NOW())`,
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

  describe('invoices', () => {
    it('POST /invoices answers 202 with the invoice in { data }', async () => {
      const res = await call('POST /invoices', {
        body: invoiceBody({ idempotencyKey: randomUUID() }),
        status: 202,
      });
      ids.invoice = res.body.data.id;
    });

    it('POST /invoices with SCHEDULE answers 202 with the schedule in { data }', async () => {
      const res = await call('POST /invoices', {
        body: invoiceBody({
          competenceDate: inDays(3),
          options: { type: 'SCHEDULE' },
        }),
        status: 202,
      });
      expect(res.body.data).toHaveProperty('next_run_on');
      ids.schedule = res.body.data.id;
    });

    it('POST /invoices/calculate answers 200 with { data } (never the bare calculation)', async () => {
      const res = await call('POST /invoices/calculate', {
        body: invoiceBody(),
        status: 200,
      });
      expect(res.body).toHaveProperty('data');
    });

    it('POST /invoices/batches answers 202 with { data }', async () => {
      await call('POST /invoices/batches', {
        body: {
          invoices: [
            invoiceBody({ idempotencyKey: randomUUID() }),
            invoiceBody({ idempotencyKey: randomUUID(), amount: -1 }),
          ],
        },
        status: 202,
      });
    });

    it('GET /invoices is a cursor page', async () => {
      const res = await call('GET /invoices', {
        query: { limit: 1 },
        status: 200,
      });
      expect(res.body.pagination).toEqual({
        limit: 1,
        hasMore: true,
        nextCursor: expect.any(String),
      });
    });

    it('reads one invoice, its events, the overview and the portal status', async () => {
      await call('GET /invoices/{id}', {
        path: `/invoices/${ids.invoice}`,
        status: 200,
      });
      await call('GET /invoices/{id}/events', {
        path: `/invoices/${ids.invoice}/events`,
        status: 200,
      });
      await call('GET /invoices/overview', { status: 200 });
      await call('GET /fiscal-portal/status', { status: 200 });
    });

    it('POST /invoices/review answers 202', async () => {
      await call('POST /invoices/review', {
        body: { action: 'retry', invoiceIds: [ids.invoice] },
      });
    });

    it('cancels a queued invoice with 200', async () => {
      await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${ids.invoice}/cancel`,
        body: {
          reason: 'other',
          description: 'Cancelamento pedido pelo cliente no teste',
        },
      });
    });
  });

  describe('authorized invoice, documents and package', () => {
    beforeAll(async () => {
      const res = await call('POST /invoices', {
        body: invoiceBody({
          idempotencyKey: randomUUID(),
          customer: {
            name: 'Cliente',
            taxId: CUSTOMER_TAX_ID,
            email: 'cliente@example.com',
          },
        }),
        status: 202,
      });
      ids.authorized = res.body.data.id;
      await dataSource.query(
        `UPDATE "${schema}".nfse_invoices
            SET status = 'authorized', authorized_at = NOW(), issued_at = NOW(),
                access_key = $2, nfse_number = 123456789012, dps_number = 42,
                dps_series = '00001', dps_id = 'DPS42', documents_ready_at = NOW()
          WHERE id = $1`,
        [ids.authorized, '3'.repeat(50)],
      );
      documents.set(`${tenantId}/${ids.authorized}.xml`, '<NFSe/>');
      documents.set(
        `${tenantId}/${ids.authorized}.pdf`,
        Buffer.from('%PDF-1.4'),
      );
    });

    it('returns the nfseNumber and dpsNumber of an authorized invoice as integers', async () => {
      const res = await call('GET /invoices/{id}', {
        path: `/invoices/${ids.authorized}`,
        status: 200,
      });
      expect(res.body.data.nfseNumber).toBe(123456789012);
      expect(res.body.data.dpsNumber).toBe(42);
    });

    it('streams the XML and the PDF as files, not inside { data }', async () => {
      const xml = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${ids.authorized}/xml`,
        status: 200,
      });
      expect(xml.text).toBe('<NFSe/>');
      const pdf = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${ids.authorized}/pdf`,
        status: 200,
      });
      expect(pdf.contentType).toContain('application/pdf');
      expect(pdf.text.startsWith('%PDF')).toBe(true);
    });

    it('POST /invoices/{id}/email answers 202, with or without a body', async () => {
      await call('POST /invoices/{id}/email', {
        path: `/invoices/${ids.authorized}/email`,
        body: { email: 'cliente@example.com' },
        status: 202,
      });
      await call('POST /invoices/{id}/email', {
        path: `/invoices/${ids.authorized}/email`,
        status: 202,
      });
    });

    it('POST /invoices/{id}/download-url answers 200', async () => {
      await call('POST /invoices/{id}/download-url', {
        path: `/invoices/${ids.authorized}/download-url`,
        body: { format: 'pdf' },
        status: 200,
      });
    });

    it('the month package: summary in { data }, the ZIP as a file', async () => {
      const month = today.slice(0, 7);
      await call('GET /companies/{companyId}/invoice-package/summary', {
        path: `/companies/${companyId}/invoice-package/summary`,
        query: { month },
        status: 200,
      });
      const zip = await call('GET /companies/{companyId}/invoice-package', {
        path: `/companies/${companyId}/invoice-package`,
        query: { month },
        status: 200,
      });
      expect(zip.contentType).toContain('application/zip');
    });

    it('substitutes the authorized invoice with 202', async () => {
      await call('POST /invoices/{id}/substitute', {
        path: `/invoices/${ids.authorized}/substitute`,
        body: { description: 'Corrigir a descrição do serviço prestado' },
      });
    });
  });

  describe('schedules', () => {
    it('lists, reads, updates, pauses, resumes and cancels', async () => {
      const list = await call('GET /schedules', { status: 200 });
      expect(list.body.pagination).toEqual({
        limit: 50,
        hasMore: false,
        nextCursor: null,
      });
      await call('GET /schedules/{id}', {
        path: `/schedules/${ids.schedule}`,
        status: 200,
      });
      await call('PATCH /schedules/{id}', {
        path: `/schedules/${ids.schedule}`,
        body: { anchorOn: inDays(5) },
        status: 200,
      });
      await call('GET /schedules/{id}/runs', {
        path: `/schedules/${ids.schedule}/runs`,
        status: 200,
      });
      await call('POST /schedules/{id}/pause', {
        path: `/schedules/${ids.schedule}/pause`,
        status: 200,
      });
      await call('POST /schedules/{id}/resume', {
        path: `/schedules/${ids.schedule}/resume`,
        status: 200,
      });
      await call('POST /schedules/{id}/cancel', {
        path: `/schedules/${ids.schedule}/cancel`,
        status: 200,
      });
    });
  });

  describe('companies', () => {
    it('creates, lists, reads and updates a company', async () => {
      const created = await call('POST /companies', {
        body: {
          legalName: 'Outra Empresa Ltda',
          taxId: '45723174000110',
          municipalityCode: '3550308',
          municipalReg: '999',
          taxRegime: 'Simples Nacional',
          simplesRate: '6.00',
        },
        status: 201,
      });
      ids.company2 = created.body.data.id;
      await call('GET /companies', { status: 200, query: { limit: 1 } });
      await call('GET /companies/{id}', {
        path: `/companies/${ids.company2}`,
        status: 200,
      });
      await call('PATCH /companies/{id}', {
        path: `/companies/${ids.company2}`,
        body: { tradeName: 'Outra' },
        status: 200,
      });
    });

    it('DPS sequence, fiscal profile, service tax profiles and accountant package', async () => {
      // The company created above, so the fiscal setup of the seeded one stays as the other cases need it.
      const id = ids.company2;
      await call('GET /companies/{id}/dps-sequence', {
        path: `/companies/${id}/dps-sequence`,
        status: 200,
      });
      await call('PUT /companies/{id}/dps-sequence', {
        path: `/companies/${id}/dps-sequence`,
        body: { lastNumber: 10 },
        status: 200,
      });
      await call('GET /companies/{id}/fiscal-profile', {
        path: `/companies/${id}/fiscal-profile`,
        status: 200,
      });
      const profile = await call('PUT /companies/{id}/fiscal-profile', {
        path: `/companies/${id}/fiscal-profile`,
        body: {
          taxRegime: 'SIMPLES_NACIONAL',
          simpleNational: true,
          validFrom: inDays(30),
        },
        status: 200,
      });
      const profileId = profile.body?.data?.id;
      if (profileId)
        await call('POST /companies/{id}/fiscal-profile/{profileId}/approve', {
          path: `/companies/${id}/fiscal-profile/${profileId}/approve`,
        });
      await call('GET /companies/{id}/service-tax-profiles', {
        path: `/companies/${id}/service-tax-profiles`,
        status: 200,
      });
      const tax = await call('POST /companies/{id}/service-tax-profiles', {
        path: `/companies/${id}/service-tax-profiles`,
        body: {
          serviceCode: '010101',
          name: 'Consultoria',
          effectiveFrom: '2026-01-01',
        },
      });
      const serviceId = tax.body?.data?.id;
      if (serviceId) {
        await call('PATCH /companies/{id}/service-tax-profiles/{serviceId}', {
          path: `/companies/${id}/service-tax-profiles/${serviceId}`,
          body: { name: 'Consultoria técnica' },
        });
        await call(
          'POST /companies/{id}/service-tax-profiles/{serviceId}/approve',
          {
            path: `/companies/${id}/service-tax-profiles/${serviceId}/approve`,
          },
        );
      }
      const expired = await call('POST /companies/{id}/service-tax-profiles', {
        path: `/companies/${id}/service-tax-profiles`,
        body: {
          serviceCode: '010102',
          name: 'Antigo',
          effectiveFrom: '2020-01-01',
          effectiveUntil: '2020-12-31',
        },
      });
      if (expired.body?.data?.id)
        await call('DELETE /companies/{id}/service-tax-profiles/{serviceId}', {
          path: `/companies/${id}/service-tax-profiles/${expired.body.data.id}`,
        });
      await call('GET /companies/{companyId}/accountant-package', {
        path: `/companies/${id}/accountant-package`,
        status: 200,
      });
      await call('PUT /companies/{companyId}/accountant-package', {
        path: `/companies/${id}/accountant-package`,
        body: { accountantEmail: 'contador@example.com' },
        status: 200,
      });
      await call('GET /companies/{companyId}/accountant-package/sends', {
        path: `/companies/${id}/accountant-package/sends`,
        status: 200,
      });
    });

    it('deletes a company answering { data: null }', async () => {
      const res = await call('DELETE /companies/{id}', {
        path: `/companies/${ids.company2}`,
      });
      expect(res.body).toEqual({ data: null });
    });
  });

  describe('certificates', () => {
    it('uploads (201), lists (page) and revokes (204)', async () => {
      process.env.NFSE_MASTER_KEY ??= randomBytes(32).toString('base64');
      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date(Date.now() - 60_000);
      cert.validity.notAfter = new Date(Date.now() + 86_400_000);
      cert.setSubject([{ name: 'commonName', value: 'Empresa Teste' }]);
      cert.setIssuer(cert.subject.attributes);
      cert.sign(keys.privateKey, forge.md.sha256.create());
      const pfx = Buffer.from(
        forge.asn1
          .toDer(
            forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'senha-teste', {
              algorithm: '3des',
            }),
          )
          .getBytes(),
        'binary',
      );
      const path = `/companies/${companyId}/certificates`;
      const uploaded = await call('POST /companies/{companyId}/certificates', {
        path,
        attach: { field: 'file', content: pfx, name: 'certificado.p12' },
        fields: { password: 'senha-teste' },
        status: 201,
      });
      await call('GET /companies/{companyId}/certificates', {
        path,
        status: 200,
      });
      const res = await call(
        'DELETE /companies/{companyId}/certificates/{certId}',
        { path: `${path}/${uploaded.body.data.id}`, status: 204 },
      );
      expect(res.text).toBe('');
    });
  });

  describe('customers and service favorites', () => {
    it('customers: page, one, update, delete', async () => {
      await dataSource.query(
        `INSERT INTO "${schema}".customers (tenant_id, environment, tax_id, name, email)
         VALUES ($1, 'test', $2, 'Cliente Salvo', 'salvo@example.com')
         ON CONFLICT DO NOTHING`,
        [tenantId, CUSTOMER_TAX_ID],
      );
      await call('GET /customers', { status: 200 });
      await call('GET /customers/{taxId}', {
        path: `/customers/${CUSTOMER_TAX_ID}`,
        status: 200,
      });
      await call('PATCH /customers/{taxId}', {
        path: `/customers/${CUSTOMER_TAX_ID}`,
        body: { name: 'Cliente Renomeado' },
        status: 200,
      });
      await call('DELETE /customers/{taxId}', {
        path: `/customers/${CUSTOMER_TAX_ID}`,
        status: 200,
      });
    });

    it('service favorites: create 201, list, delete', async () => {
      const path = `/companies/${companyId}/service-favorites`;
      const created = await call(
        'POST /companies/{companyId}/service-favorites',
        {
          path,
          body: {
            label: 'Consultoria',
            description: 'Consultoria em TI',
            serviceCode: '010101',
          },
          status: 201,
        },
      );
      await call('GET /companies/{companyId}/service-favorites', {
        path,
        status: 200,
      });
      await call(
        'DELETE /companies/{companyId}/service-favorites/{favoriteId}',
        { path: `${path}/${created.body.data.id}`, status: 200 },
      );
    });
  });

  describe('imports', () => {
    const csv = Buffer.from(
      [
        'cnpj_prestador;tomador_documento;tomador_nome;descricao;valor;data_competencia',
        `${COMPANY_TAX_ID};${CUSTOMER_TAX_ID};Ana;Consultoria;1.500,00;${today}`,
        `${COMPANY_TAX_ID};${CUSTOMER_TAX_ID};Caio;Ruim;abc;${today}`,
      ].join('\n'),
    );
    const startImport = async () => {
      const res = await call('POST /imports', {
        attach: { field: 'file', content: csv, name: 'notas.csv' },
        fields: { companyId },
        status: 202,
      });
      await ctx.moduleFixture.get(ImportReaderService).read({
        tenantId,
        environment: 'test',
        importId: res.body.data.id,
      });
      // The reader has stored its rows: one is valid, one is not.
      const stored: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM "${schema}".import_rows WHERE import_id = $1`,
        [res.body.data.id],
      );
      expect(stored.map((row) => row.status).sort()).toEqual([
        'invalid',
        'valid',
      ]);
      return res.body.data.id as string;
    };

    it('start 202, list, get, rows page, fix a row, emit 202, the CSVs', async () => {
      const id = await startImport();
      await call('GET /imports', { status: 200 });
      await call('GET /imports/{id}', { path: `/imports/${id}`, status: 200 });
      await call('GET /imports/{id}/rows', {
        path: `/imports/${id}/rows`,
        query: { limit: 1 },
        status: 200,
      });
      const errors = await call('GET /imports/{id}/errors.csv', {
        path: `/imports/${id}/errors.csv`,
        status: 200,
      });
      expect(errors.contentType).toContain('text/csv');
      await call('PATCH /imports/{id}/rows/{line}', {
        path: `/imports/${id}/rows/3`,
        body: { item: { amount: 99.9 } },
        status: 200,
      });
      const emitting = await startImport();
      await call('POST /imports/{id}/emit', {
        path: `/imports/${emitting}/emit`,
        status: 202,
      });
      const template = await call('GET /imports/template', { status: 200 });
      expect(template.contentType).toContain('text/csv');
      expect(template.text).toContain('cnpj_prestador');
    });

    it('discard answers 204 without a body', async () => {
      const id = await startImport();
      const res = await call('DELETE /imports/{id}', {
        path: `/imports/${id}`,
        status: 204,
      });
      expect(res.text).toBe('');
    });
  });

  describe('webhooks', () => {
    it('create 201 with the secret, list, deliveries, stats, delete', async () => {
      const created = await call('POST /webhooks', {
        body: {
          url: 'https://93.184.216.34/hook',
          events: ['nfse.invoice.authorized'],
        },
        status: 201,
      });
      expect(created.body.data.secret).toEqual(expect.any(String));
      await call('GET /webhooks', { status: 200 });
      await call('GET /webhooks/deliveries', { status: 200 });
      await call('GET /webhooks/deliveries/stats', { status: 200 });
      await call('DELETE /webhooks/{id}', {
        path: `/webhooks/${created.body.data.id}`,
        status: 200,
      });
    });
  });

  describe('credits, billing, plans, health', () => {
    it('credits and billing', async () => {
      await call('GET /credits', { status: 200 });
      await call('GET /credits/plans', { status: 200 });
      await call('GET /credits/history', { status: 200 });
      await call('GET /credits/purchase/preview', {
        query: { units: 3 },
        status: 200,
      });
      await call('GET /billing/plan', { status: 200 });
      await call('GET /billing/usage', { status: 200 });
    });

    it('looks up a CNPJ', async () => {
      await call('GET /cnpj/{cnpj}', {
        path: `/cnpj/${COMPANY_TAX_ID}`,
        status: 200,
      });
    });

    it('the public price list and the bare health check', async () => {
      await call('GET /plans', { status: 200 });
      await call('GET /plans/{slug}', { path: '/plans/solo', status: 200 });
      const health = await call('GET /health/live', { status: 200 });
      expect(health.body).not.toHaveProperty('data');
    });
  });

  describe('integrations', () => {
    it('provider and connection lists, a connection and its rules', async () => {
      await call('GET /integrations/providers', { status: 200 });
      const created = await call('POST /integrations/connections', {
        body: { provider: 'woovi', companyId, credentials: {} },
        status: 201,
      });
      const id = created.body.data.id as string;
      const base = `/integrations/connections/${id}`;
      await call('GET /integrations/connections', { status: 200 });
      await call('GET /integrations/connections/{id}', {
        path: base,
        status: 200,
      });
      await call('PUT /integrations/connections/{id}/rules', {
        path: `${base}/rules`,
        body: {
          rules: [
            {
              service: { description: 'Consultoria', code: '010101' },
              sendEmail: false,
            },
          ],
        },
        status: 200,
      });
      await call('GET /integrations/connections/{id}/rules', {
        path: `${base}/rules`,
        status: 200,
      });
      await call('GET /integrations/connections/{id}/events', {
        path: `${base}/events`,
        status: 200,
      });
      await call('GET /integrations/connections/{id}/operations', {
        path: `${base}/operations`,
        status: 200,
      });
      await call('POST /integrations/connections/{id}/validate', {
        path: `${base}/validate`,
        status: 200,
      });
      await call('POST /integrations/connections/{id}/activate', {
        path: `${base}/activate`,
        status: 200,
      });
      await call('POST /integrations/connections/{id}/pause', {
        path: `${base}/pause`,
        status: 200,
      });
      await call('POST /integrations/connections/{id}/disconnect', {
        path: `${base}/disconnect`,
      });
    });
  });

  it('covers every operation, except the ones that need an outside service or a payment event', () => {
    // These need a live Woovi/AbacatePay event, a delivery to a real URL or an outbound e-mail.
    // Their controllers return plain objects (wrapped in { data } by the interceptor) and are
    // reviewed by hand; a new public operation must get a case above or be listed here.
    const outside = [
      'POST /companies/{companyId}/accountant-package/send',
      'PUT /integrations/connections/{id}/credentials',
      'PATCH /integrations/operations/{id}/customer',
      'POST /integrations/operations/{id}/retry',
      'POST /webhooks/{id}/test',
      'POST /webhooks/deliveries/{id}/retry',
    ];
    expect(allOperations().filter((key) => !covered.has(key))).toEqual(outside);
  });

  it('every answer matches the published contract', () => {
    expect(problems).toEqual([]);
  });
});
