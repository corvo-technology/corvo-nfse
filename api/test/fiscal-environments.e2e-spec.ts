import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument,@typescript-eslint/no-require-imports */
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { NfseClient, Ambiente } from 'open-nfse';
import { OpenNfseProvider } from '@/infra/external/nfse/open-nfse.provider';
import { NfseWorkflowService } from '@/modules/invoice/application/nfse-workflow.service';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { InvoiceLifecycleService } from '@/modules/invoice/application/invoice-lifecycle.service';
import { Invoice } from '@/modules/invoice/domain/invoice';
import { InvoiceEvent } from '@/modules/invoice/domain/invoice-event';
import { ApiKeyService } from '@/modules/auth/application/api-key.service';
import { CookieSessionService } from '@/modules/auth/application/cookie-session.service';
import { AuthUserService } from '@/modules/auth/application/auth-user.service';
import { MillionSendEmailProvider } from '@/infra/external/email/mmsend-email.provider';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookDispatcherAdapter } from '@/modules/webhooks-config/infra/webhook-dispatcher.adapter';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { NfseDocPrepProcessor } from '@/modules/invoice/jobs/nfse-doc-prep.processor';
import { NfseEmissionProcessor } from '@/modules/invoice/jobs/nfse-emission.processor';
import { ModulesContainer } from '@nestjs/core';

// Disable the manual SDK mock used by the default unit suite.
jest.unmock('open-nfse');

const tenant = randomUUID();
const otherTenant = randomUUID();
const emails: any[] = [];
const nativeRequire = process
  .getBuiltinModule('module')
  .createRequire(`${process.cwd()}/package.json`);
// The SDK owns Undici 8; the root dependency is Undici 6 and is incompatible.
const { MockAgent } = process
  .getBuiltinModule('module')
  .createRequire(nativeRequire.resolve('open-nfse'))('undici');
const fiscalTransport = new MockAgent();
fiscalTransport.disableNetConnect();
const s3 = new S3Client({
  endpoint: process.env.STORAGE_S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const bucket = process.env.STORAGE_S3_BUCKET!;
const pool = {
  max: 10,
  min: 0,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 15000,
  maxLifetimeSeconds: 1800,
};
const companyBody = {
  legalName: 'Empresa integração',
  taxId: '11222333000181',
  taxRegime: 'MEI',
  municipalityCode: '3550308',
  municipalReg: '12345',
  defaultServiceCode: '010101',
};
const invoiceBody = (companyId: string, extra = {}) => ({
  companyId,
  customer: {
    taxId: '52998224725',
    name: 'Cliente <Teste>',
    email: 'integration@example.invalid',
  },
  service: {
    description: 'Consultoria & implantação',
    code: '010101',
    municipalityCode: '3550308',
  },
  amount: 150.25,
  competenceDate: '2026-09-01',
  ...extra,
});
const waitFor = async <T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
) => {
  for (let n = 0; n < 100; n++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for worker result');
};

describe('Fiscal environments with real HTTP, PostgreSQL, Redis, S3 and worker', () => {
  let db: DataSource;
  let entities: any[];
  let app: INestApplication;
  let worker: TestingModule;
  let testKey: string;
  let liveKey: string;
  let otherKey: string;
  let cookie: string;
  let csrf: string;
  let testCompany: string;
  let liveCompany: string;
  let invoiceId: string;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    key = testKey,
  ) => request(app.getHttpServer())[method](`/v1${path}`).set('x-api-key', key);
  const dash = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    environment?: string,
  ) => {
    const call = request(app.getHttpServer())
      [method](`/v1${path}`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:4000')
      .set('X-CSRF-Token', csrf);
    return environment ? call.set('X-Corvo-Environment', environment) : call;
  };

  beforeAll(async () => {
    const glob = require('glob');
    entities = glob
      .sync(
        'src/{modules,infra/persistence/typeorm}/**/*.{orm-entity,orm-entities,entity}.ts',
      )
      .flatMap((file: string) =>
        Object.values(require(`${process.cwd()}/${file}`)),
      )
      .filter((value: any) => typeof value === 'function');
    db = new DataSource({
      ...createTypeOrmOptions({
        url: process.env.DATABASE_URL!,
        schema: process.env.DB_SCHEMA,
        ssl: false,
        logging: false,
        pool,
      }),
      entities,
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${process.env.DB_SCHEMA}"`);
    await db.runMigrations();
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    const { AppModule } = require('@/app.module');
    const { WorkerAppModule } = require('@/worker-app.module');
    const builder = (module: any) =>
      Test.createTestingModule({ imports: [module] })
        .overrideProvider(DataSource)
        .useFactory({
          factory: async () =>
            new DataSource({
              ...createTypeOrmOptions({
                url: process.env.DATABASE_URL!,
                schema: process.env.DB_SCHEMA,
                ssl: false,
                logging: false,
                pool,
              }),
              entities,
            }).initialize(),
        })
        .overrideProvider(OpenNfseProvider)
        .useFactory({
          inject: [DataSource],
          factory: (database: DataSource) => {
            const provider = new OpenNfseProvider(database);
            // Exercise the real SDK/certificate/XSD/retry store; only replace HTTP.
            jest.spyOn(provider as any, 'client').mockImplementation(
              (payload: any, retryStore: any) =>
                new NfseClient({
                  ambiente: Ambiente.Producao,
                  certificado: {
                    pfx: payload.pfxBuffer,
                    password: payload.p12Password,
                  },
                  retryStore,
                  dispatcher: fiscalTransport,
                }),
            );
            return provider;
          },
        })
        .overrideProvider(MillionSendEmailProvider)
        .useValue({
          send: async (message: any) => {
            emails.push(message);
            return { id: 'local-email' };
          },
        })
        .overrideProvider(WebhookDispatcherAdapter)
        .useValue({
          dispatch: async () => ({ statusCode: 200, durationMs: 1 }),
        });
    app = (await builder(AppModule).compile()).createNestApplication({
      logger: false,
    });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await db.query(
      `INSERT INTO "${process.env.DB_SCHEMA}".tenants(id) VALUES ($1),($2)`,
      [tenant, otherTenant],
    );
    const keys = app.get(ApiKeyService);
    testKey = (
      await keys.create({ activeTenantId: tenant } as any, {
        name: 'test',
        environment: 'test',
        scope: 'full_access',
      })
    ).plaintext;
    liveKey = (
      await keys.create({ activeTenantId: tenant } as any, {
        name: 'live',
        environment: 'live',
        scope: 'full_access',
      })
    ).plaintext;
    otherKey = (
      await keys.create({ activeTenantId: otherTenant } as any, {
        name: 'other',
        environment: 'test',
        scope: 'full_access',
      })
    ).plaintext;
    const user = await app.get(AuthUserService).createUser({
      email: `fiscal-${tenant}@example.invalid`,
      name: 'Integração',
    });
    await db.query(
      `INSERT INTO "${process.env.DB_SCHEMA}".tenant_memberships(auth_user_id,tenant_id) VALUES ($1,$2)`,
      [user.id, tenant],
    );
    const sessions = app.get(CookieSessionService);
    const session = await sessions.createSession({
      authUserId: user.id,
      activeTenantId: tenant,
      userAgent: null,
      ipHash: null,
      expiresAt: new Date(Date.now() + 3600000),
    });
    cookie = `gf_session_dev=${session.sessionToken}`;
    csrf = sessions.generateCsrfToken(session.session.id);
    worker = await builder(WorkerAppModule).compile();
    await worker.init();
  }, 60000);

  afterAll(async () => {
    if (worker) await worker.close();
    if (app) {
      for (const name of [
        'email',
        'nfse-emission',
        'nfse-reconciliation',
        'nfse-doc-prep',
        'nfse-email',
      ])
        await app
          .get(BullmqQueueService)
          .getQueue(name)
          .obliterate({ force: true });
      const redis = app.get<any>(REDIS_CLIENT);
      let cursor = '0';
      do {
        const result = await redis.scan(
          cursor,
          'MATCH',
          `${process.env.REDIS_KEY_PREFIX}:*`,
          'COUNT',
          1000,
        );
        cursor = result[0];
        if (result[1].length) await redis.del(...result[1]);
      } while (cursor !== '0');
      await app.close();
    }
    try {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      );
      if (listed.Contents?.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: listed.Contents.map((item) => ({ Key: item.Key })),
            },
          }),
        );
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch {
      /* Bucket may not exist if setup failed. */
    }
    s3.destroy();
    await fiscalTransport.close();
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${process.env.DB_SCHEMA}" CASCADE`);
      await db.destroy();
    }
  }, 30000);

  it('migrates a clean database with no ORM schema drift', async () => {
    const diff = await db.driver.createSchemaBuilder().log();
    expect(diff.upQueries.map((q) => q.query)).toEqual([]);
    expect(await db.runMigrations()).toEqual([]);
  });

  it('upgrades legacy environment values and preserves the old document key layout', async () => {
    const schema = `${process.env.DB_SCHEMA}_upgrade`;
    const upgrade = new DataSource({
      ...createTypeOrmOptions({
        url: process.env.DATABASE_URL!,
        schema,
        ssl: false,
        logging: false,
        pool,
      }),
      entities,
    });
    await upgrade.initialize();
    try {
      await upgrade.query(`CREATE SCHEMA "${schema}"`);
      const all = upgrade.migrations;
      upgrade.migrations = all.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1791589200000,
      );
      await upgrade.runMigrations();
      const legacyCompany = randomUUID(),
        legacyInvoice = randomUUID();
      await upgrade.query(`INSERT INTO tenants(id) VALUES ($1)`, [tenant]);
      await upgrade.query(
        `INSERT INTO nfse_companies(id,tenant_id,legal_name,tax_id,tax_regime,environment,status) VALUES ($1,$2,'Legacy','11222333000181','MEI','production','ready')`,
        [legacyCompany, tenant],
      );
      await upgrade.query(
        `INSERT INTO nfse_invoices(id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,idempotency_key) VALUES ($1,$2,$3,'authorized','{}','{}','{}',100,'2026-09-01','legacy-order')`,
        [legacyInvoice, legacyCompany, tenant],
      );
      upgrade.migrations = all;
      const applied = await upgrade.runMigrations();
      expect(applied.map((m) => m.name)).toContain(
        'SeparateFiscalEnvironments1791589200000',
      );
      const company = await upgrade.query(
        `SELECT environment FROM nfse_companies WHERE id=$1`,
        [legacyCompany],
      );
      const invoice = await upgrade
        .getRepository(InvoiceOrmEntity)
        .findOneByOrFail({ id: legacyInvoice });
      expect(company[0].environment).toBe('live');
      expect(invoice.environment).toBe('live');
      expect(invoice.documentKeyVersion).toBe(1);
      expect(
        (await upgrade.driver.createSchemaBuilder().log()).upQueries,
      ).toEqual([]);
    } finally {
      await upgrade.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await upgrade.destroy();
    }
  });

  it('boots API and worker with fiscal processors owned only by the worker', () => {
    for (const Processor of [NfseEmissionProcessor, NfseDocPrepProcessor]) {
      const count = (container: ModulesContainer) =>
        [...container.values()].filter((module) =>
          module.providers.has(Processor),
        ).length;
      expect(count(app.get(ModulesContainer))).toBe(0);
      expect(count(worker.get(ModulesContainer))).toBe(1);
    }
  });
  it('validates municipality and live municipal registration at company registration', async () => {
    const { municipalityCode, municipalReg, ...base } = companyBody;
    const missing = await api('post', '/companies')
      .send({ ...base, municipalReg })
      .expect(400);
    expect(missing.body.code).toBe('ERROR_BAD_REQUEST');
    const invalid = await api('post', '/companies')
      .send({ ...companyBody, municipalityCode: 'abcdefg' })
      .expect(422);
    expect(invalid.body.code).toBe('ERROR_VALIDATION');
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'municipalityCode',
          code: 'ERROR_INVALID_IBGE_CODE',
        }),
      ]),
    );
    const live = await api('post', '/companies', liveKey)
      .send({ ...base, municipalityCode })
      .expect(422);
    expect(live.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'municipalReg',
          code: 'ERROR_REQUIRED',
        }),
      ]),
    );
  });

  it('creates the same CNPJ independently; keys ignore even invalid environment headers', async () => {
    const first = await api('post', '/companies')
      .set('X-Corvo-Environment', 'production')
      .send(companyBody)
      .expect(201);
    testCompany = first.body.data.id;
    expect(first.body.data.environment).toBe('test');
    const second = await api('post', '/companies', liveKey)
      .set('X-Corvo-Environment', 'test')
      .send(companyBody)
      .expect(201);
    liveCompany = second.body.data.id;
    expect(second.body.data.environment).toBe('live');
    expect(testCompany).not.toBe(liveCompany);
  });
  it('dashboard defaults to test and selects live with its header', async () => {
    const tests = await dash('get', '/companies').expect(200);
    expect(tests.body.data.map((c: { id: string }) => c.id)).toEqual([
      testCompany,
    ]);
    const lives = await dash('get', '/companies', 'live').expect(200);
    expect(lives.body.data.map((c: { id: string }) => c.id)).toEqual([
      liveCompany,
    ]);
    await dash('get', '/companies', 'prod').expect(400);
  });
  it('returns 404 for cross-environment or cross-tenant company IDs and disallows mutation of environment', async () => {
    await api('get', `/companies/${liveCompany}`).expect(404);
    await api('get', `/companies/${testCompany}`, otherKey).expect(404);
    await api('patch', `/companies/${testCompany}`)
      .send({ environment: 'live' })
      .expect(400);
    await api('post', '/invoices').send(invoiceBody(liveCompany)).expect(404);
    await api('get', `/companies/${liveCompany}/certificates`).expect(404);
    await api('delete', `/companies/${liveCompany}`).expect(404);
  });
  it('enforces the live company limit while test companies consume no slots', async () => {
    await api('post', '/companies', liveKey)
      .send({ ...companyBody, taxId: '19131243000197' })
      .expect(422);
    await api('post', '/companies')
      .send({ ...companyBody, taxId: '19131243000197' })
      .expect(201);
  });
  it('simulates an invoice with no certificate, prepares real XML/PDF and sends both attachments', async () => {
    await app.get(IWebhookConfigRepository).save(
      {
        id: randomUUID(),
        tenantId: tenant,
        url: 'https://example.invalid/webhooks',
        events: ['nfse.invoice.authorized', 'nfse.invoice.documents_ready'],
        secret: 'integration-only-secret',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      tenant,
    );
    const sent = await api('post', '/invoices')
      .set('Idempotency-Key', 'same-order')
      .send(invoiceBody(testCompany, { email: true }))
      .expect(202);
    invoiceId = sent.body.data.id;
    expect(sent.body.data.environment).toBe('test');
    const finished = await waitFor(
      () =>
        db.getRepository(InvoiceOrmEntity).findOneByOrFail({ id: invoiceId }),
      (row) => row.lastEmailStatus === 'sent',
    ).catch(async () => {
      const row = await db
        .getRepository(InvoiceOrmEntity)
        .findOneByOrFail({ id: invoiceId });
      const jobs = await Promise.all(
        ['nfse-emission', 'nfse-doc-prep', 'nfse-email'].map(async (name) => ({
          queue: name,
          jobs: (
            await app
              .get(BullmqQueueService)
              .getQueue(name as any)
              .getJobs(['failed', 'delayed', 'active', 'waiting'])
          ).map((job) => ({ name: job.name, failedReason: job.failedReason })),
        })),
      );
      throw new Error(
        JSON.stringify({
          status: row.status,
          emailStatus: row.lastEmailStatus,
          documentsReady: !!row.documentsReadyAt,
          lastError: row.lastErrorMessage,
          jobs,
        }),
      );
    });
    expect(finished.status).toBe('authorized');
    expect(finished.documentsReadyAt).toBeInstanceOf(Date);
    expect(emails[0].subject).toContain('[TESTE]');
    expect(emails[0].attachments[0].content.subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    expect(emails[0].attachments[1].content.toString()).toContain(
      'SIMULAÇÃO SEM VALIDADE FISCAL',
    );
    expect(
      await db
        .getRepository(CreditTransactionOrmEntity)
        .count({ where: { tenantId: tenant } }),
    ).toBe(0);
    const hook = await db.query(
      `SELECT environment,payload FROM "${process.env.DB_SCHEMA}".webhook_deliveries WHERE tenant_id = $1`,
      [tenant],
    );
    expect(hook.length).toBeGreaterThanOrEqual(2);
    expect(
      hook.every(
        (row: any) =>
          row.environment === 'test' && row.payload.environment === 'test',
      ),
    ).toBe(true);
  }, 20000);
  it('reuses normalized idempotent requests, rejects changed content and protects every document route', async () => {
    const again = await api('post', '/invoices')
      .set('Idempotency-Key', 'same-order')
      .send(invoiceBody(testCompany, { email: true }))
      .expect(202);
    expect(again.body.data.id).toBe(invoiceId);
    await api('post', '/invoices')
      .set('Idempotency-Key', 'same-order')
      .send(invoiceBody(testCompany, { amount: 200, email: true }))
      .expect(409);
    for (const suffix of ['', '/events', '/pdf', '/xml'])
      await api('get', `/invoices/${invoiceId}${suffix}`, liveKey).expect(404);
    await api('post', `/invoices/${invoiceId}/download-url`, liveKey)
      .send({ format: 'pdf' })
      .expect(404);
    await api('post', `/invoices/${invoiceId}/email`, liveKey)
      .send({})
      .expect(404);
    const download = await api('post', `/invoices/${invoiceId}/download-url`)
      .send({ format: 'pdf' })
      .expect(200);
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.body.data.downloadUrl).toContain(
      `/test/invoices/${invoiceId}/invoice.pdf`,
    );
    const direct = await fetch(download.body.data.downloadUrl);
    expect(direct.status).toBe(200);
    expect(
      Buffer.from(await direct.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    await api('post', `/invoices/${invoiceId}/email`)
      .set('Idempotency-Key', 'manual-send')
      .send({})
      .expect(202);
    await waitFor(
      async () => emails.length,
      (count) => count === 2,
    );
    await api('post', `/invoices/${invoiceId}/email`)
      .set('Idempotency-Key', 'manual-send')
      .send({})
      .expect(202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(emails).toHaveLength(2);
  });
  it('reserves the last monthly allowance atomically and settles live credits once', async () => {
    const wallet = db.getRepository(CreditTransactionOrmEntity);
    await wallet.save({
      tenantId: tenant,
      amount: 1,
      type: 'bonus',
      isReservation: false,
    });
    const lifecycle = app.get(InvoiceLifecycleService);
    const make = () =>
      Invoice.create(
        {
          ...invoiceBody(liveCompany),
          environment: 'live',
          competenceDate: new Date('2026-09-01'),
        },
        tenant,
      );
    const usage = await app.get(BillingUsageService).status(tenant);
    await db.query(
      `UPDATE billing_usage_periods SET authorized = included - 1, reserved = 0 WHERE id = $1 AND tenant_id = $2`,
      [usage.period.id, tenant],
    );
    const a = make(),
      b = make();
    const results = await Promise.allSettled(
      [a, b].map((invoice) =>
        lifecycle.submit(
          invoice,
          InvoiceEvent.create(invoice.id, null, 'queued'),
          3,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? a : b;
    await lifecycle.transition(winner, winner.transitionTo('processing'));
    winner.setRejected('REJECTED', 'Controlled rejection');
    const rejected = winner.transitionTo('rejected');
    await Promise.all([
      lifecycle.transition(winner, rejected),
      lifecycle.transition(winner, rejected),
    ]);
    const totals = await wallet
      .createQueryBuilder('t')
      .select('SUM(t.amount)', 'balance')
      .where('t.tenant_id = :tenant', { tenant })
      .getRawOne();
    expect(Number(totals.balance)).toBe(1);
    const c = make();
    await lifecycle.submit(c, InvoiceEvent.create(c.id, null, 'queued'), 3);
    await lifecycle.transition(c, c.transitionTo('processing'));
    c.setAuthorized('controlled-live-access-key', 1);
    await lifecycle.transition(c, c.transitionTo('authorized'));
    expect(
      (await wallet.findOneByOrFail({ reservedInvoiceId: c.id })).isReservation,
    ).toBe(false);
    expect(
      await wallet.count({
        where: { type: 'invoice_rejected', tenantId: tenant },
      }),
    ).toBe(1);
    // Remove the synthetic historical usage used to exercise the final allowance.
    await db.query(
      `UPDATE billing_usage_periods SET authorized = 1 WHERE id = $1 AND tenant_id = $2`,
      [usage.period.id, tenant],
    );
  });
  it('uploads a password-protected real PKCS12 and keeps the password encrypted for live mTLS', async () => {
    const forge = require('node-forge');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: 'commonName', value: 'Empresa 11222333000181' }]);
    cert.setIssuer(cert.subject.attributes);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const password = 'integration-pfx-password';
    const pfx = Buffer.from(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
            algorithm: '3des',
          }),
        )
        .getBytes(),
      'binary',
    );
    await api('post', `/companies/${liveCompany}/certificates`, liveKey)
      .field('password', password)
      .attach('file', pfx, 'certificate.p12')
      .expect(201);
    const decrypted = await app
      .get(ApplicationCertificateDecryptor)
      .decryptCredentials(liveCompany, tenant, 'live');
    expect(decrypted.pfxBuffer.equals(pfx)).toBe(true);
    expect(decrypted.password).toBe(password);
    const stored = await db.query(
      `SELECT encrypted_blob FROM "${process.env.DB_SCHEMA}".nfse_certificates WHERE company_id=$1`,
      [liveCompany],
    );
    expect(stored[0].encrypted_blob.includes(Buffer.from(password))).toBe(
      false,
    );
    await api('get', `/companies/${liveCompany}/certificates`).expect(404);
  });
  it('signs live DPS with the real SDK and retries the persisted XML without reserving again', async () => {
    await db.getRepository(CreditTransactionOrmEntity).save({
      tenantId: tenant,
      amount: 1,
      type: 'bonus',
      isReservation: false,
    });
    const fixture = await db
      .getRepository(InvoiceOrmEntity)
      .createQueryBuilder('i')
      .where('i.id = :id', { id: invoiceId })
      .getOneOrFail();
    const accessKey = fixture.accessKey!;
    const xml = (
      await app
        .get<IDocumentStorage>(DOCUMENT_STORAGE)
        .getXml(
          fixture.tenantId,
          invoiceId,
          fixture.environment as ExecutionEnvironment,
        )
    ).replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>');
    const captured: string[] = [];
    const http = fiscalTransport.get('https://sefin.nfse.gov.br');
    const capture = (body: string) => {
      captured.push(
        gunzipSync(
          Buffer.from(JSON.parse(body).dpsXmlGZipB64, 'base64'),
        ).toString(),
      );
    };
    http
      .intercept({ method: 'POST', path: '/SefinNacional/nfse' })
      .reply((options: any) => {
        capture(options.body);
        return {
          statusCode: 503,
          data: JSON.stringify({ message: 'controlled outage' }),
        };
      });
    const issued = await api('post', '/invoices', liveKey)
      .set('X-Corvo-Environment', 'test')
      .set('Idempotency-Key', 'live-retry')
      .send(invoiceBody(liveCompany))
      .expect(202);
    const id = issued.body.data.id;
    expect(issued.body.data.environment).toBe('live');
    const pending = await waitFor(
      () => db.getRepository(InvoiceOrmEntity).findOneByOrFail({ id }),
      (row) =>
        row.status === 'reconciliation_required' || row.status === 'rejected',
    ).catch(async () => {
      const state = await db
        .getRepository(InvoiceOrmEntity)
        .createQueryBuilder('i')
        .addSelect('i.pendingEmission')
        .where('i.id = :id', { id })
        .getOneOrFail();
      const jobs = await app
        .get(BullmqQueueService)
        .getQueue('nfse-emission')
        .getJobs(['failed', 'delayed', 'active']);
      throw new Error(
        JSON.stringify({
          status: state.status,
          pending: !!state.pendingEmission,
          captured: captured.length,
          lastError: state.lastErrorMessage,
          jobs: jobs.map((job) => ({ failedReason: job.failedReason })),
        }),
      );
    });
    expect(pending.status).toBe('reconciliation_required');
    const stored = await db
      .getRepository(InvoiceOrmEntity)
      .createQueryBuilder('i')
      .addSelect('i.pendingEmission')
      .where('i.id = :id', { id })
      .getOneOrFail();
    if (!captured.length) {
      const jobs = await app
        .get(BullmqQueueService)
        .getQueue('nfse-emission')
        .getJobs(['failed', 'delayed', 'active']);
      throw new Error(
        JSON.stringify({
          status: pending.status,
          lastError: pending.lastErrorMessage,
          jobs: jobs.map((job) => ({
            failedReason: job.failedReason,
            stack: job.stacktrace,
          })),
        }),
      );
    }
    expect(stored.pendingEmission?.xmlAssinado).toBe(captured[0]);
    expect(captured[0]).toContain('<Signature');
    expect(captured[0]).toContain('<tpAmb>1</tpAmb>');
    expect(captured[0]).toContain('<dCompet>2026-09-01</dCompet>');
    expect(
      new Date(stored.pendingEmission!.notBefore as string).getTime(),
    ).toBeGreaterThan(Date.now());
    // Advance only this fixture's persisted retry window, keeping the signed XML.
    await db.query(
      `UPDATE nfse_invoices SET pending_emission=jsonb_set(pending_emission,'{notBefore}',to_jsonb($1::text)) WHERE id=$2`,
      [new Date(Date.now() - 1000).toISOString(), id],
    );
    http
      .intercept({ method: 'GET', path: `/SefinNacional/dps/${stored.dpsId}` })
      .reply(404, {});
    http
      .intercept({ method: 'POST', path: '/SefinNacional/nfse' })
      .reply((options: any) => {
        capture(options.body);
        return {
          statusCode: 201,
          data: JSON.stringify({
            chaveAcesso: accessKey,
            idDps: stored.dpsId,
            nfseXmlGZipB64: gzipSync(xml).toString('base64'),
            tipoAmbiente: 1,
            dataHoraProcessamento: new Date().toISOString(),
          }),
        };
      });
    await worker.get(NfseWorkflowService).process({
      invoiceId: id,
      tenantId: tenant,
      companyId: liveCompany,
      apiKeyEnvironment: 'test',
    });
    const ready = await waitFor(
      () => db.getRepository(InvoiceOrmEntity).findOneByOrFail({ id }),
      (row) => !!row.documentsReadyAt,
    );
    expect(ready.status).toBe('authorized');
    expect(captured).toHaveLength(2);
    expect(captured[1]).toBe(captured[0]);
    const debit = await db
      .getRepository(CreditTransactionOrmEntity)
      .findBy({ reservedInvoiceId: id });
    expect(debit).toHaveLength(1);
    expect(debit[0].isReservation).toBe(false);
    const finalized = await db
      .getRepository(InvoiceOrmEntity)
      .createQueryBuilder('i')
      .addSelect('i.pendingEmission')
      .where('i.id = :id', { id })
      .getOneOrFail();
    expect(finalized.pendingEmission).toBeNull();
    fiscalTransport.assertNoPendingInterceptors();
  }, 20000);
  it('issues by companyTaxId with inherited defaults, freezes values and allows a distinct place of service', async () => {
    const payload = {
      companyTaxId: '11.222.333/0001-81',
      customer: { name: 'Cliente', taxId: '52998224725' },
      service: { description: 'Desenvolvimento' },
      amount: 10,
      competenceDate: '2026-09-01',
    };
    const created = await api('post', '/invoices')
      .set('Idempotency-Key', 'company-defaults')
      .send(payload)
      .expect(202);
    const id = created.body.data.id ?? created.body.data.id;
    const ready = await waitFor(
      () => db.getRepository(InvoiceOrmEntity).findOneByOrFail({ id }),
      (row) => !!row.documentsReadyAt,
    );
    expect(ready.status).toBe('authorized');
    expect(ready.serviceSnapshot).toMatchObject({
      code: '010101',
      municipalityCode: '3550308',
    });
    await api('patch', `/companies/${testCompany}`)
      .send({ defaultServiceCode: '010201', municipalityCode: '3170206' })
      .expect(200);
    const repeated = await api('post', '/invoices')
      .set('Idempotency-Key', 'company-defaults')
      .send(payload)
      .expect(202);
    expect(repeated.body.data.id).toBe(id);
    expect(repeated.body.data.serviceSnapshot).toMatchObject({
      code: '010101',
      municipalityCode: '3550308',
    });
    const override = await api('post', '/invoices')
      .send({
        ...payload,
        service: {
          description: 'Outra prestação',
          municipalityCode: '3550308',
        },
      })
      .expect(202);
    const overrideId = override.body.data.id;
    const other = await waitFor(
      () =>
        db.getRepository(InvoiceOrmEntity).findOneByOrFail({ id: overrideId }),
      (row) => !!row.documentsReadyAt,
    );
    expect(other.serviceSnapshot).toMatchObject({
      code: '010201',
      municipalityCode: '3550308',
    });
    const download = await api('get', `/invoices/${overrideId}/xml`).expect(
      200,
    );
    const xml = download.text ?? Buffer.from(download.body).toString();
    expect(xml).toContain('<cLocEmi>3170206</cLocEmi>');
    expect(xml).toContain('<cLocPrestacao>3550308</cLocPrestacao>');
    expect(xml).toContain('<cTribNac>010201</cTribNac>');
    await api('post', '/invoices', otherKey).send(payload).expect(404);
    await api('patch', `/companies/${testCompany}`)
      .send({ defaultServiceCode: null })
      .expect(200);
    const noDefault = await api('post', '/invoices').send(payload).expect(422);
    expect(noDefault.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'service.code',
          code: 'ERROR_REQUIRED',
        }),
      ]),
    );
    await api('patch', `/companies/${testCompany}`)
      .send({ municipalityCode: null })
      .expect(400);
  }, 20000);
});
