/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- supertest bodies and raw SQL rows are untyped; node-forge ships no types */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
                cnae: { code: '9602501', description: 'Cabeleireiros' },
                secondaryCnaes: [],
                suggestedServiceCode: {
                  code: '060101',
                  description: 'Barbearia',
                },
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
          // NF-e files, by reference (the key layout itself is tested in the storage spec).
          saveFile: (
            ref: { tenantId: string; environment: string; id: string },
            name: string,
            body: Buffer | string,
          ) =>
            Promise.resolve(
              void documents.set(
                `${ref.tenantId}/${ref.environment}/nfe/${ref.id}/${name}`,
                body,
              ),
            ),
          fileExists: (
            ref: { tenantId: string; environment: string; id: string },
            name: string,
          ) =>
            Promise.resolve(
              documents.has(
                `${ref.tenantId}/${ref.environment}/nfe/${ref.id}/${name}`,
              ),
            ),
          getFile: (
            ref: { tenantId: string; environment: string; id: string },
            name: string,
          ) =>
            Promise.resolve(
              Buffer.from(
                documents.get(
                  `${ref.tenantId}/${ref.environment}/nfe/${ref.id}/${name}`,
                ) as Buffer | string,
              ),
            ),
          getFileSignedUrl: (
            _ref: unknown,
            name: string,
            options: { downloadName: string },
          ) =>
            Promise.resolve({
              url: `https://files.example/nfe/${name}`,
              expiresAt: new Date(Date.now() + 60_000),
              fileName: options.downloadName,
              mimeType: name.endsWith('.pdf')
                ? 'application/pdf'
                : 'application/xml',
            }),
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
          municipal_reg, environment, status, address_state, created_at, updated_at)
       VALUES ($1, $2, 'Empresa Teste', $3, '3550308', '12345', 'test', 'ready', 'SP', NOW(), NOW())`,
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
      // The test environment answers from the simulated provider, so the portal lookup runs for real.
      await call('POST /companies/{id}/dps-sequence/check', {
        path: `/companies/${id}/dps-sequence/check`,
        status: 200,
      });
      await call('POST /companies/{id}/dps-sequence/confirm', {
        path: `/companies/${id}/dps-sequence/confirm`,
        body: { lastNumber: 12 },
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
      const seed = async (fiscal: string, key: string) => {
        const rows: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO "${schema}".integration_operations
             (tenant_id, connection_id, provider, environment, external_account_id, operation_key, commercial_state, fiscal_status, block_reason, snapshot)
           VALUES ($1, $2, 'woovi', 'test', 'acc', $3, 'paid', $4, 'customer_tax_id_missing', $5::jsonb)
           RETURNING id`,
          [
            tenantId,
            id,
            key,
            fiscal,
            JSON.stringify({
              operationKey: key,
              commercialState: 'paid',
              externalRefs: {},
              occurredAt: '2026-11-26T15:00:00.000Z',
              paidAt: '2026-11-26T15:00:00.000Z',
              currency: 'BRL',
              amountCents: 990,
              discountCents: 0,
              customer: {
                name: 'ACME',
                email: null,
                taxId: null,
                taxIdMasked: false,
              },
              items: [],
              sellerIssuesInvoice: true,
            }),
          ],
        );
        return rows[0].id;
      };
      const waiting = await seed('needs_attention', 'charge:waiting');
      const resolvable = await seed('needs_attention', 'charge:resolvable');
      const listed = await call('GET /integrations/operations', {
        query: { environment: 'test' },
        status: 200,
      });
      expect(
        (listed.body.data as Array<{ id: string }>).map((row) => row.id),
      ).toContain(waiting);
      await call('GET /integrations/operations/{id}', {
        path: `/integrations/operations/${waiting}`,
        status: 200,
      });
      await call('POST /integrations/operations/{id}/ignore', {
        path: `/integrations/operations/${waiting}/ignore`,
        body: { reason: 'Venda de teste' },
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
      await call('POST /integrations/operations/{id}/resolve', {
        path: `/integrations/operations/${resolvable}/resolve`,
        body: {
          customer: { taxId: '11222333000181', name: 'ACME LTDA' },
          service: { description: 'Consultoria' },
          sendEmail: false,
        },
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

  describe('nfe settings', () => {
    it('sets and reads the NF-e settings of a company', async () => {
      const path = `/companies/${companyId}/nfe-settings`;
      await call('PUT /companies/{id}/nfe-settings', {
        path,
        body: { stateRegistration: '110042490114', crt: 1 },
        status: 200,
      });
      const res = await call('GET /companies/{id}/nfe-settings', {
        path,
        status: 200,
      });
      expect(res.body.data.stateRegistration).toBe('110042490114');
      expect(res.body.data.nfceDefaultSeries).toBe(1);
    });

    it('tells whether the company can issue NF-e (the simulator has no SEFAZ cadastro, so it is not asked)', async () => {
      const res = await call('GET /companies/{id}/nfe-settings', {
        path: `/companies/${companyId}/nfe-settings?check=sefaz`,
        status: 200,
      });
      expect(res.body.data.readiness).toMatchObject({
        companyId,
        ready: false,
      });
      expect(['unavailable', 'company_incomplete']).toContain(
        res.body.data.readiness.status,
      );
    });

    it('sets the NFC-e series apart from the NF-e one', async () => {
      const path = `/companies/${companyId}/nfe-settings`;
      const saved = await call('PUT /companies/{id}/nfe-settings', {
        path,
        body: {
          stateRegistration: '110042490114',
          crt: 1,
          defaultSeries: 2,
          nfceDefaultSeries: 7,
        },
        status: 200,
      });
      expect(saved.body.data).toMatchObject({
        defaultSeries: 2,
        nfceDefaultSeries: 7,
      });
      await call('PUT /companies/{id}/nfe-settings', {
        path,
        body: { stateRegistration: '110042490114', crt: 1 },
        status: 200,
      });
    });

    it('validates an NF-e without sending it: 200 when complete, 422 with the problems otherwise', async () => {
      await dataSource.query(
        `UPDATE "${schema}".nfse_companies
            SET address_street = 'Avenida Paulista', address_number = '1000', address_district = 'Bela Vista',
                address_zip = '01310100', address_city = 'São Paulo'
          WHERE id = $1`,
        [companyId],
      );
      const nfe = {
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
      };
      const ok = await call('POST /invoices/validate', {
        body: nfe,
        query: { includeXml: 'true' },
        status: 200,
      });
      expect(ok.body.data.valid).toBe(true);
      expect(ok.body.data.accessKeyPreview).toHaveLength(44);
      const bad = await call('POST /invoices/validate', {
        body: { ...nfe, payments: [{ tPag: '17', amount: 1 }] },
        status: 422,
      });
      expect(bad.body.type).toBe('validation');
    });

    it('POST /invoices/validate with type=nfce answers 200 with { data } and 422 with the issues', async () => {
      const nfce = {
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
      };
      const ok = await call('POST /invoices/validate', {
        body: nfce,
        query: { includeXml: 'true' },
        status: 200,
      });
      expect(ok.body.data.valid).toBe(true);
      expect(ok.body.data.accessKeyPreview.slice(20, 22)).toBe('65');
      expect(ok.body.data.xml).toContain('<infNFeSupl>');
      const bad = await call('POST /invoices/validate', {
        body: { ...nfce, indPres: 4 },
        status: 422,
      });
      expect(bad.body.type).toBe('validation');
    });
  });

  describe('nfe issuing', () => {
    const nfeBody = () => ({
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
    });

    const setStatus = (id: string, status: string, extra = '') =>
      dataSource.query(
        `UPDATE "${schema}".nfe_documents SET status = $2${extra} WHERE id = $1`,
        [id, status],
      );

    it('issues, lists and reads an NF-e, then handles a rejection and a lost answer', async () => {
      await dataSource.query(
        `UPDATE "${schema}".nfse_companies
            SET address_street = 'Avenida Paulista', address_number = '1000', address_district = 'Bela Vista',
                address_zip = '01310100', address_city = 'São Paulo'
          WHERE id = $1`,
        [companyId],
      );
      await call('PUT /companies/{id}/nfe-settings', {
        path: `/companies/${companyId}/nfe-settings`,
        body: { stateRegistration: '110042490114', crt: 1 },
        status: 200,
      });

      // The header is required.
      const missing = await call('POST /invoices', {
        body: nfeBody(),
        status: 400,
      });
      expect(missing.body.code).toBe('ERROR_IDEMPOTENCY_KEY_REQUIRED');

      const created = await call('POST /invoices', {
        body: nfeBody(),
        headers: { 'Idempotency-Key': 'e2e-nfe-1' },
        status: 202,
      });
      const id = created.body.data.id as string;
      expect(created.body.data.status).toBe('queued');

      // The same key and body is the same note; another body with the key is a conflict.
      const again = await call('POST /invoices', {
        body: nfeBody(),
        headers: { 'Idempotency-Key': 'e2e-nfe-1' },
        status: 200,
      });
      expect(again.body.data).toEqual({
        type: 'nfe',
        id,
        status: 'queued',
        replayed: true,
      });
      await call('POST /invoices', {
        body: { ...nfeBody(), additionalInfo: 'outro corpo' },
        headers: { 'Idempotency-Key': 'e2e-nfe-1' },
        status: 409,
      });

      const list = await call('GET /invoices', {
        query: { type: 'nfe', companyId, status: 'queued' },
        status: 200,
      });
      expect(list.body.data.map((n: { id: string }) => n.id)).toContain(id);
      const read = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(read.body.data).toMatchObject({
        id,
        status: 'queued',
        number: null,
        lastError: null,
        environment: 'test',
      });

      // `type=all` mixes both kinds in one cursor list; walking it one by one loses and repeats nothing.
      const everything = await call('GET /invoices', {
        query: { type: 'all', companyId, limit: 100 },
        status: 200,
      });
      const kinds = new Map(
        everything.body.data.map((row: { id: string; type: string }) => [
          row.id,
          row.type,
        ]),
      );
      expect(kinds.get(id)).toBe('nfe');
      expect(kinds.get(ids.invoice)).toBe('nfse');
      const walked: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await call('GET /invoices', {
          query: {
            type: 'all',
            companyId,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          },
          status: 200,
        });
        walked.push(...page.body.data.map((row: { id: string }) => row.id));
        cursor = page.body.pagination.nextCursor ?? undefined;
      } while (cursor);
      expect(walked).toEqual(
        everything.body.data.map((row: { id: string }) => row.id),
      );

      // What only an NF-e has is refused for an NFS-e, with a code that says so.
      const refusals: Array<[string, string, object?]> = [
        ['POST /invoices/{id}/sync', 'sync'],
        ['POST /invoices/{id}/discard', 'discard'],
        [
          'POST /invoices/{id}/corrections',
          'corrections',
          { correction: 'Corrigir o endereço de entrega para Rua das Flores' },
        ],
      ];
      for (const [key, suffix, payload] of refusals) {
        const refused = await call(key, {
          path: `/invoices/${ids.invoice}/${suffix}`,
          ...(payload ? { body: payload } : {}),
          status: 422,
        });
        expect(refused.body.code).toBe('ERROR_INVOICE_OPERATION_NOT_SUPPORTED');
      }
      const dryRun = await call('POST /invoices/validate', {
        body: { type: 'nfse' },
        status: 422,
      });
      expect(dryRun.body.code).toBe('ERROR_INVOICE_OPERATION_NOT_SUPPORTED');

      // A rejection shows its type, code and hint; the note is corrected and sent again.
      await setStatus(
        id,
        'rejected',
        `, last_error_type = 'validation', last_error_code = '225', last_error_message = 'Rejeição: Falha no Schema XML do lote de NFe'`,
      );
      const rejected = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(rejected.body.data.lastError).toMatchObject({
        type: 'validation',
        code: '225',
        hint: expect.stringContaining('schema'),
      });
      const resubmitted = await call('PUT /invoices/{id}', {
        path: `/invoices/${id}`,
        body: { ...nfeBody(), additionalInfo: 'corrigida' },
        status: 202,
      });
      expect(resubmitted.body.data).toEqual({
        type: 'nfe',
        id,
        status: 'queued',
      });

      // A rejected note can also be given up; an authorized one cannot.
      await setStatus(id, 'rejected');
      const discarded = await call('POST /invoices/{id}/discard', {
        path: `/invoices/${id}/discard`,
        status: 200,
      });
      expect(discarded.body.data.status).toBe('discarded');
      await setStatus(id, 'authorized');
      const refused = await call('POST /invoices/{id}/discard', {
        path: `/invoices/${id}/discard`,
        status: 409,
      });
      expect(refused.body.code).toBe('ERROR_NFE_INVALID_STATE');

      // A lost answer: the SEFAZ (the simulator) does not know the key yet, so sync leaves it waiting.
      const lost = await call('POST /invoices', {
        body: { ...nfeBody(), additionalInfo: 'resposta perdida' },
        headers: { 'Idempotency-Key': 'e2e-nfe-2' },
        status: 202,
      });
      const lostId = lost.body.data.id as string;
      await setStatus(
        lostId,
        'reconciliation_required',
        `, access_key = '35261112345678000195550010000000011234567810', signed_xml = '<NFe/>', issued_at = now()`,
      );
      const synced = await call('POST /invoices/{id}/sync', {
        path: `/invoices/${lostId}/sync`,
        status: 200,
      });
      expect(synced.body.data.status).toBe('reconciliation_required');
    });
  });

  describe('nfe events', () => {
    const accessKeyOf = (n: number) =>
      `3526111234567800019555001${String(n + 500).padStart(9, '0')}1234567810`.slice(
        0,
        44,
      );
    const body = (extra: string) => ({
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
      additionalInfo: extra,
    });
    /** An NF-e the SEFAZ authorized, as the worker would have left it (the simulator is not asked). */
    const authorized = async (label: string, n: number) => {
      const created = await call('POST /invoices', {
        body: body(label),
        headers: { 'Idempotency-Key': `e2e-events-${label}` },
        status: 202,
      });
      const id = created.body.data.id as string;
      await dataSource.query(
        `UPDATE "${schema}".nfe_documents
            SET status = 'authorized', series = 1, number = $2, access_key = $3, protocol = '135260000000001',
                signed_xml = '<NFe/>', issued_at = now(), authorized_at = now()
          WHERE id = $1`,
        [id, 900 + n, accessKeyOf(n)],
      );
      return id;
    };

    it('cancels, corrects, lists the timeline, inutilizes a range and lists the gaps', async () => {
      // Cancellation: the justification is checked, then the NF-e is cancelling and cannot be cancelled twice.
      const toCancel = await authorized('cancel', 1);
      const short = await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${toCancel}/cancel`,
        body: { justification: 'curta' },
        status: 422,
      });
      expect(short.body.code).toBe('ERROR_JUSTIFICATION_LENGTH');
      const cancelled = await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${toCancel}/cancel`,
        body: {
          justification: 'Pedido cancelado pelo cliente antes da entrega',
        },
        status: 202,
      });
      expect(cancelled.body.data).toMatchObject({
        id: toCancel,
        status: 'cancelling',
        cancelReason: 'Pedido cancelado pelo cliente antes da entrega',
      });
      const twice = await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${toCancel}/cancel`,
        body: {
          justification: 'Pedido cancelado pelo cliente antes da entrega',
        },
        status: 409,
      });
      expect(twice.body.code).toBe('ERROR_NFE_INVALID_STATE');

      // Correction letters: each takes the next sequence.
      const toCorrect = await authorized('correct', 2);
      const tooShort = await call('POST /invoices/{id}/corrections', {
        path: `/invoices/${toCorrect}/corrections`,
        body: { correction: 'curta' },
        status: 422,
      });
      expect(tooShort.body.code).toBe('ERROR_CORRECTION_LENGTH');
      const first = await call('POST /invoices/{id}/corrections', {
        path: `/invoices/${toCorrect}/corrections`,
        body: { correction: 'Corrigir o endereço de entrega da observação' },
        status: 202,
      });
      expect(first.body.data).toMatchObject({
        sequence: 1,
        status: 'pending',
        type: 'correction',
      });
      const second = await call('POST /invoices/{id}/corrections', {
        path: `/invoices/${toCorrect}/corrections`,
        body: { correction: 'Corrigir também a informação adicional' },
        status: 202,
      });
      expect(second.body.data.sequence).toBe(2);
      const timeline = await call('GET /invoices/{id}/events', {
        path: `/invoices/${toCorrect}/events`,
        status: 200,
      });
      expect(
        timeline.body.data
          .filter((e: { kind: string }) => e.kind === 'event')
          .map((e: { sequence: number }) => e.sequence),
      ).toEqual([1, 2]);

      // Inutilization: bad range, a free range, the same key again, an overlap, the list.
      const inut = {
        type: 'nfe',
        companyId,
        series: 7,
        start: 10,
        end: 12,
        justification: 'Numeração pulada por falha do sistema emissor',
      };
      const inverted = await call('POST /invoices/inutilizations', {
        body: { ...inut, start: 12, end: 10 },
        status: 422,
      });
      expect(inverted.body.code).toBe('ERROR_INUTILIZATION_RANGE_INVALID');
      const accepted = await call('POST /invoices/inutilizations', {
        body: inut,
        headers: { 'Idempotency-Key': 'e2e-inut-1' },
        status: 202,
      });
      expect(accepted.body.data).toMatchObject({
        status: 'pending',
        series: 7,
        start: 10,
        end: 12,
      });
      const replayed = await call('POST /invoices/inutilizations', {
        body: inut,
        headers: { 'Idempotency-Key': 'e2e-inut-1' },
        status: 200,
      });
      expect(replayed.body.data).toMatchObject({
        id: accepted.body.data.id,
        replayed: true,
      });
      const overlap = await call('POST /invoices/inutilizations', {
        body: { ...inut, start: 12, end: 15 },
        status: 409,
      });
      expect(overlap.body.code).toBe('ERROR_INUTILIZATION_RANGE_OVERLAP');
      const inUse = await call('POST /invoices/inutilizations', {
        body: { ...inut, series: 1, start: 901, end: 901 },
        status: 409,
      });
      expect(inUse.body.code).toBe('ERROR_INUTILIZATION_RANGE_IN_USE');
      const inutList = await call('GET /invoices/inutilizations', {
        query: { type: 'nfe', companyId, status: 'pending' },
        status: 200,
      });
      expect(inutList.body.data.map((i: { id: string }) => i.id)).toContain(
        accepted.body.data.id,
      );

      // Gaps: the range voided by the request above (still pending) is a gap until the SEFAZ approves it.
      const gaps = await call('GET /invoices/number-gaps', {
        query: { type: 'nfe', companyId },
        status: 200,
      });
      expect(gaps.body.data).toEqual(
        expect.arrayContaining([{ companyId, series: 7, start: 1, end: 12 }]),
      );
    });
  });

  describe('nfe files', () => {
    const body = () => ({
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
      additionalInfo: 'arquivos',
    });

    it('serves the nfeProc, the DANFE and a signed link once the documents are ready; 409 before', async () => {
      const created = await call('POST /invoices', {
        body: body(),
        headers: { 'Idempotency-Key': 'e2e-nfe-files' },
        status: 202,
      });
      const id = created.body.data.id as string;
      await dataSource.query(
        `UPDATE "${schema}".nfe_documents
            SET status = 'authorized', series = 1, number = 77, access_key = '35261111222333000181550010000000771123456780',
                protocol = '135260000000001', signed_xml = '<NFe/>', issued_at = now(), authorized_at = now()
          WHERE id = $1`,
        [id],
      );

      // Not stored yet: every file route answers 409.
      for (const [key, path, extra] of [
        ['GET /invoices/{id}/xml', `/invoices/${id}/xml`, {}],
        ['GET /invoices/{id}/pdf', `/invoices/${id}/pdf`, {}],
        [
          'POST /invoices/{id}/download-url',
          `/invoices/${id}/download-url`,
          { body: { format: 'xml' } },
        ],
      ] as const) {
        const early = await call(key, { path, status: 409, ...extra });
        expect(early.body.code).toBe('ERROR_DOCUMENTS_NOT_READY');
      }
      const unknown = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${randomUUID()}/xml`,
        status: 404,
      });
      expect(unknown.body.code).toBe('ERROR_INVOICE_NOT_FOUND');

      // What the worker leaves behind: the files and the ready mark.
      const stored = `${tenantId}/test/nfe/${id}`;
      documents.set(`${stored}/nfe-proc.xml`, '<nfeProc/>');
      documents.set(`${stored}/danfe.pdf`, Buffer.from('%PDF-1.4 danfe'));
      await dataSource.query(
        `UPDATE "${schema}".nfe_documents SET documents_ready_at = now() WHERE id = $1`,
        [id],
      );

      const xml = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${id}/xml`,
        status: 200,
      });
      expect(xml.text).toBe('<nfeProc/>');
      expect(xml.contentType).toContain('application/xml');
      const pdf = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        status: 200,
      });
      expect(pdf.contentType).toContain('application/pdf');
      expect(pdf.text.startsWith('%PDF')).toBe(true);
      const link = await call('POST /invoices/{id}/download-url', {
        path: `/invoices/${id}/download-url`,
        body: { format: 'pdf' },
        status: 200,
      });
      expect(link.body.data).toMatchObject({
        fileName: 'nfe-77.pdf',
        mimeType: 'application/pdf',
      });
      await call('POST /invoices/{id}/download-url', {
        path: `/invoices/${id}/download-url`,
        body: { format: 'zip' },
        status: 400,
      });
      const read = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(read.body.data).toMatchObject({
        documentsReady: true,
        emailStatus: null,
      });
    });
  });

  describe('nfce issuing', () => {
    const nfceBody = (extra: Record<string, unknown> = {}) => ({
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
    const setNfce = (id: string, sets: string, params: unknown[] = []) =>
      dataSource.query(
        `UPDATE "${schema}".nfe_documents SET ${sets} WHERE id = $1`,
        [id, ...params],
      );

    beforeAll(async () => {
      await dataSource.query(
        `UPDATE "${schema}".nfse_companies
            SET address_street = 'Avenida Paulista', address_number = '1000', address_district = 'Bela Vista',
                address_zip = '01310100', address_city = 'São Paulo'
          WHERE id = $1`,
        [companyId],
      );
      await call('PUT /companies/{id}/nfe-settings', {
        path: `/companies/${companyId}/nfe-settings`,
        body: { stateRegistration: '110042490114', crt: 1 },
        status: 200,
      });
    });

    it('issues, replays, lists and reads a NFC-e; the other operations follow its state', async () => {
      const missing = await call('POST /invoices', {
        body: nfceBody(),
        status: 400,
      });
      expect(missing.body.code).toBe('ERROR_IDEMPOTENCY_KEY_REQUIRED');

      const created = await call('POST /invoices', {
        body: nfceBody(),
        headers: { 'Idempotency-Key': 'e2e-nfce-1' },
        status: 202,
      });
      const id = created.body.data.id as string;
      expect(created.body.data).toEqual({
        type: 'nfce',
        id,
        status: 'queued',
      });
      const again = await call('POST /invoices', {
        body: nfceBody(),
        headers: { 'Idempotency-Key': 'e2e-nfce-1' },
        status: 200,
      });
      expect(again.body.data).toEqual({
        type: 'nfce',
        id,
        status: 'queued',
        replayed: true,
      });
      await call('POST /invoices', {
        body: nfceBody({ additionalInfo: 'outro corpo' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-1' },
        status: 409,
      });

      // Only model 65 is listed with type=nfce; type=nfe does not see it; type=all mixes them.
      const list = await call('GET /invoices', {
        query: { type: 'nfce', companyId, status: 'queued' },
        status: 200,
      });
      expect(list.body.data.map((n: { id: string }) => n.id)).toEqual([id]);
      const nfeList = await call('GET /invoices', {
        query: { type: 'nfe', companyId, limit: 100 },
        status: 200,
      });
      expect(nfeList.body.data.map((n: { id: string }) => n.id)).not.toContain(
        id,
      );
      const everything = await call('GET /invoices', {
        query: { type: 'all', companyId, limit: 100 },
        status: 200,
      });
      expect(
        everything.body.data.find((row: { id: string }) => row.id === id).type,
      ).toBe('nfce');

      const read = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(read.body.data).toMatchObject({
        type: 'nfce',
        id,
        model: 65,
        status: 'queued',
        recipient: null,
        number: null,
        lastError: null,
        qrCode: null,
        urlChave: null,
        environment: 'test',
      });

      // What the worker leaves behind once the SEFAZ authorizes it.
      await setNfce(
        id,
        `status = 'authorized', series = 1, number = 31, access_key = '35261111222333000181650010000000311123456780',
         protocol = '135260000000001', signed_xml = '<NFe/>', issued_at = now(), authorized_at = now(),
         qr_code = 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=x|3|2',
         url_chave = 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta'`,
      );
      const authorized = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(authorized.body.data).toMatchObject({
        status: 'authorized',
        qrCode: expect.stringContaining('|3|2'),
        urlChave: expect.stringContaining('/consulta'),
      });

      // No correction letter for the NFC-e.
      const correction = await call('POST /invoices/{id}/corrections', {
        path: `/invoices/${id}/corrections`,
        body: { correction: 'Corrigir o endereço de entrega da observação' },
        status: 422,
      });
      expect(correction.body.code).toBe(
        'ERROR_INVOICE_OPERATION_NOT_SUPPORTED',
      );

      // Sync on a settled note answers the note; discard needs a rejected one.
      const synced = await call('POST /invoices/{id}/sync', {
        path: `/invoices/${id}/sync`,
        status: 200,
      });
      expect(synced.body.data).toMatchObject({
        type: 'nfce',
        status: 'authorized',
      });
      const notDiscardable = await call('POST /invoices/{id}/discard', {
        path: `/invoices/${id}/discard`,
        status: 409,
      });
      expect(notDiscardable.body.code).toBe('ERROR_NFE_INVALID_STATE');

      // Cancellation: the justification is checked, then the NFC-e is cancelling.
      const short = await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${id}/cancel`,
        body: { justification: 'curta' },
        status: 422,
      });
      expect(short.body.code).toBe('ERROR_JUSTIFICATION_LENGTH');
      const cancelled = await call('POST /invoices/{id}/cancel', {
        path: `/invoices/${id}/cancel`,
        body: {
          justification: 'Pedido cancelado pelo cliente antes da entrega',
        },
        status: 202,
      });
      expect(cancelled.body.data).toMatchObject({
        type: 'nfce',
        id,
        status: 'cancelling',
      });
      const timeline = await call('GET /invoices/{id}/events', {
        path: `/invoices/${id}/events`,
        status: 200,
      });
      // The cancellation is told once: the request, with the justification, and no row of its own.
      expect(
        timeline.body.data.some(
          (entry: { kind: string; status: string; text: string | null }) =>
            entry.kind === 'status' &&
            entry.status === 'cancelling' &&
            entry.text === 'Pedido cancelado pelo cliente antes da entrega',
        ),
      ).toBe(true);
      expect(
        timeline.body.data.some(
          (entry: { tpEvento: string | null }) => entry.tpEvento === '110111',
        ),
      ).toBe(false);
    });

    it('issues a NFC-e off-line (contingency "offline"): 201 at once with the key, the QR Code and the files; the same key answers 200', async () => {
      const created = await call('POST /invoices', {
        body: nfceBody({ contingency: 'offline', additionalInfo: 'offline' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-offline' },
        status: 201,
      });
      const id = created.body.data.id as string;
      expect(created.body.data).toMatchObject({
        type: 'nfce',
        status: 'contingency_pending',
        xmlUrl: `/v1/invoices/${id}/xml`,
        pdfUrl: `/v1/invoices/${id}/pdf`,
      });
      expect((created.body.data.accessKey as string)[34]).toBe('9');
      expect(created.body.data.qrCode).toContain(
        `?p=${created.body.data.accessKey as string}|3|2|`,
      );
      const detail = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(detail.body.data).toMatchObject({
        status: 'contingency_pending',
        contingencyReason:
          'Emissao em contingencia off-line solicitada pelo emitente',
      });
      const xml = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${id}/xml`,
        status: 200,
      });
      expect(xml.text).toContain('<tpEmis>9</tpEmis>');
      const pdf = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        status: 200,
      });
      expect(pdf.text.startsWith('%PDF-')).toBe(true);
      const again = await call('POST /invoices', {
        body: nfceBody({ contingency: 'offline', additionalInfo: 'offline' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-offline' },
        status: 200,
      });
      expect(again.body.data).toMatchObject({
        id,
        status: 'contingency_pending',
        replayed: true,
      });
    });

    it('serves the DANFCE of a NFC-e: 80 mm by default, A4 with ?layout=a4, 409 before the documents are ready', async () => {
      const created = await call('POST /invoices', {
        body: nfceBody({ additionalInfo: 'cupom' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-danfce' },
        status: 202,
      });
      const id = created.body.data.id as string;
      await setNfce(
        id,
        `status = 'authorized', series = 1, number = 32, access_key = '35261111222333000181650010000000321123456780',
         protocol = '135260000000002', signed_xml = '<NFe/>', issued_at = now(), authorized_at = now()`,
      );
      const early = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        status: 409,
      });
      expect(early.body.code).toBe('ERROR_DOCUMENTS_NOT_READY');

      // What the worker leaves behind: the nfeProc and the cupom, then the ready mark.
      const stored = `${tenantId}/test/nfe/${id}`;
      documents.set(
        `${stored}/nfe-proc.xml`,
        readFileSync(
          join(
            __dirname,
            '../src/modules/nfce/infra/danfce/__fixtures__/nfce-proc-simples.xml',
          ),
          'utf8',
        ),
      );
      documents.set(`${stored}/danfce.pdf`, Buffer.from('%PDF-1.4 cupom 80mm'));
      await setNfce(id, `documents_ready_at = now()`);

      const cupom = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        status: 200,
      });
      expect(cupom.contentType).toContain('application/pdf');
      expect(cupom.text).toContain('cupom 80mm');
      const a4 = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        query: { layout: 'a4' },
        status: 200,
      });
      expect(a4.contentType).toContain('application/pdf');
      expect(a4.text.startsWith('%PDF-')).toBe(true);
      expect(a4.text).not.toContain('cupom 80mm');
      expect(a4.text).toContain('/MediaBox [0 0 595.28 841.89]');
      const explicit = await call('GET /invoices/{id}/pdf', {
        path: `/invoices/${id}/pdf`,
        query: { layout: '80mm' },
        status: 200,
      });
      expect(explicit.text).toContain('cupom 80mm');
      const link = await call('POST /invoices/{id}/download-url', {
        path: `/invoices/${id}/download-url`,
        body: { format: 'pdf' },
        status: 200,
      });
      expect(link.body.data).toMatchObject({
        fileName: 'nfce-32.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('corrects a rejected NFC-e and sends it again, or gives it up', async () => {
      const created = await call('POST /invoices', {
        body: nfceBody({ additionalInfo: 'rejeitada' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-2' },
        status: 202,
      });
      const id = created.body.data.id as string;
      await setNfce(
        id,
        `status = 'rejected', last_error_type = 'validation', last_error_code = '225', last_error_message = 'Rejeição: Falha no Schema XML do lote de NFe'`,
      );
      const rejected = await call('GET /invoices/{id}', {
        path: `/invoices/${id}`,
        status: 200,
      });
      expect(rejected.body.data.lastError).toMatchObject({
        type: 'validation',
        code: '225',
        hint: expect.stringContaining('schema'),
      });
      const resubmitted = await call('PUT /invoices/{id}', {
        path: `/invoices/${id}`,
        body: nfceBody({ additionalInfo: 'corrigida' }),
        status: 202,
      });
      expect(resubmitted.body.data).toEqual({
        type: 'nfce',
        id,
        status: 'queued',
      });
      await setNfce(id, `status = 'rejected'`);
      const discarded = await call('POST /invoices/{id}/discard', {
        path: `/invoices/${id}/discard`,
        status: 200,
      });
      expect(discarded.body.data).toMatchObject({
        type: 'nfce',
        status: 'discarded',
      });
    });

    it('serves the nfeProc of a NFC-e once the documents are ready', async () => {
      const created = await call('POST /invoices', {
        body: nfceBody({ additionalInfo: 'arquivos' }),
        headers: { 'Idempotency-Key': 'e2e-nfce-files' },
        status: 202,
      });
      const id = created.body.data.id as string;
      await setNfce(
        id,
        `status = 'authorized', series = 1, number = 77, access_key = '35261111222333000181650010000000771123456780',
         protocol = '135260000000001', signed_xml = '<NFe/>', issued_at = now(), authorized_at = now()`,
      );
      const early = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${id}/xml`,
        status: 409,
      });
      expect(early.body.code).toBe('ERROR_DOCUMENTS_NOT_READY');
      documents.set(`${tenantId}/test/nfe/${id}/nfe-proc.xml`, '<nfeProc/>');
      await setNfce(id, `documents_ready_at = now()`);
      const xml = await call('GET /invoices/{id}/xml', {
        path: `/invoices/${id}/xml`,
        status: 200,
      });
      expect(xml.text).toBe('<nfeProc/>');
      const link = await call('POST /invoices/{id}/download-url', {
        path: `/invoices/${id}/download-url`,
        body: { format: 'xml' },
        status: 200,
      });
      expect(link.body.data).toMatchObject({
        fileName: 'nfce-77.xml',
        mimeType: 'application/xml',
      });
    });

    it('inutilizes a range of the NFC-e series, lists it and lists the gaps', async () => {
      const inut = {
        type: 'nfce',
        companyId,
        series: 8,
        start: 10,
        end: 12,
        justification: 'Numeração pulada por falha do sistema emissor',
      };
      const accepted = await call('POST /invoices/inutilizations', {
        body: inut,
        headers: { 'Idempotency-Key': 'e2e-nfce-inut-1' },
        status: 202,
      });
      expect(accepted.body.data).toMatchObject({
        status: 'pending',
        model: 65,
        series: 8,
        start: 10,
        end: 12,
      });
      const replayed = await call('POST /invoices/inutilizations', {
        body: inut,
        headers: { 'Idempotency-Key': 'e2e-nfce-inut-1' },
        status: 200,
      });
      expect(replayed.body.data).toMatchObject({
        id: accepted.body.data.id,
        replayed: true,
      });
      const overlap = await call('POST /invoices/inutilizations', {
        body: { ...inut, start: 12, end: 15 },
        status: 409,
      });
      expect(overlap.body.code).toBe('ERROR_INUTILIZATION_RANGE_OVERLAP');
      const nfceList = await call('GET /invoices/inutilizations', {
        query: { type: 'nfce', companyId },
        status: 200,
      });
      expect(nfceList.body.data.map((i: { id: string }) => i.id)).toContain(
        accepted.body.data.id,
      );
      const nfeList = await call('GET /invoices/inutilizations', {
        query: { type: 'nfe', companyId },
        status: 200,
      });
      expect(nfeList.body.data.map((i: { id: string }) => i.id)).not.toContain(
        accepted.body.data.id,
      );
      const gaps = await call('GET /invoices/number-gaps', {
        query: { type: 'nfce', companyId },
        status: 200,
      });
      expect(gaps.body.data).toEqual(
        expect.arrayContaining([{ companyId, series: 8, start: 1, end: 12 }]),
      );
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
