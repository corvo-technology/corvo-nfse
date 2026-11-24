/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-require-imports */
import { randomUUID, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import {
  configureHttpTransport,
  configureHttpGlobalPrefix,
} from '@/bootstrap-http';
import { createValidationPipe } from '@/shared/http/validation-pipe';
import { TenantPlanService } from '@/modules/plans/application/tenant-plan.service';
import { TENANT_PLAN_REPOSITORY } from '@/modules/plans/domain/tenant-plan-assignment';
import type { ITenantPlanRepository } from '@/modules/plans/domain/tenant-plan-assignment';
import { ApiKeyService } from '@/modules/auth/application/api-key.service';
import type { AuthContext } from '@/modules/auth/auth-context';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
const redisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integration requires a local _test database');
const describeIntegration = url && redisUrl ? describe : describe.skip;
const schema = `billing_plan_conc_${randomUUID().replaceAll('-', '')}`;
const asTenantAdmin = (activeTenantId: string): AuthContext =>
  ({
    activeTenantId,
    principalType: 'tenant_member',
    role: 'admin',
    permissions: [],
  }) as unknown as AuthContext;

describeIntegration('GET /v1/billing/plan under concurrent tenants', () => {
  let admin: DataSource;
  let db: DataSource;
  let app: NestExpressApplication;
  const role = `${schema}_runtime`;
  const tenants = [randomUUID(), randomUUID()];
  const companies = [randomUUID(), randomUUID()];
  const keys: string[] = [];
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      DB_SCHEMA: schema,
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: schema,
      SENTRY_ENABLED: 'false',
      LOG_LEVEL: 'error',
      RATE_LIMIT_AUTHENTICATED: '100000',
      RATE_LIMIT_PUBLIC: '100000',
      RATE_LIMIT_PRE_AUTH: '100000',
    });
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await admin.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
    );
    const restricted = new URL(url!);
    restricted.username = role;
    restricted.password = password;
    db = await new DataSource(
      createTypeOrmOptions({
        url: restricted.toString(),
        schema,
        ssl: false,
        logging: false,
      }),
    ).initialize();
    const { AppModule } = require('@/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
      logger: false,
    });
    configureHttpTransport(app);
    configureHttpGlobalPrefix(app, 'v1');
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    for (let i = 0; i < 2; i++) {
      await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
        tenants[i],
      ]);
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
        [companies[i], tenants[i]],
      );
      keys.push(
        (
          await app.get(ApiKeyService).create(asTenantAdmin(tenants[i]), {
            name: 'Test',
            environment: 'test',
            scope: 'full_access',
          })
        ).plaintext,
      );
    }
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  }, 30000);

  it('never fails or crosses tenants while the page fires parallel requests', async () => {
    const get = (path: string, i: number) =>
      request(app.getHttpServer()).get(`/v1${path}`).set('x-api-key', keys[i]);
    const results: Array<{ path: string; status: number; body: any }> = [];
    const paths = (i: number) => [
      '/billing/plan',
      '/billing/plan',
      '/companies',
      `/companies/${companies[i]}/certificates?limit=20`,
      '/credits/history',
      '/invoices?limit=5',
    ];
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: any) => {
      const e = (m as { err?: Error }).err;
      logged.push(
        `${e?.name}: ${e?.message?.slice(0, 200)} | ${e?.stack?.split('\n').slice(1, 8).join(' ; ').slice(0, 900)}`,
      );
    });
    // Like the dashboard: a burst of parallel requests, the two tenants at once.
    for (let round = 0; round < 25; round++) {
      const jobs: Array<Promise<void>> = [];
      for (const i of [0, 1])
        for (const path of paths(i))
          jobs.push(
            get(path, i).then((r) => {
              results.push({ path, status: r.status, body: r.body });
            }),
          );
      await Promise.all(jobs);
    }
    expect([...new Set(logged)]).toEqual([]);
    const bad = results.filter((r) => r.status >= 500 || r.status === 404);
    expect(bad).toEqual([]);
  }, 120000);

  it('first-assignment creation never overwrites an existing tenant row', async () => {
    // Simulates getOrCreate after a transient "tenant not visible" read: the row exists.
    const tenantId = tenants[0];
    const old = new Date('2026-01-01T00:00:00Z');
    await admin.query(
      `UPDATE "${schema}".tenants SET created_at=$2, plan_id=(SELECT id FROM "${schema}".plans WHERE slug<>'free' LIMIT 1) WHERE id=$1`,
      [tenantId, old],
    );
    await admin.query(
      `INSERT INTO "${schema}".tenant_billing (tenant_id, billing_email) VALUES ($1,'owner@example.com') ON CONFLICT (tenant_id) DO UPDATE SET billing_email='owner@example.com'`,
      [tenantId],
    );
    const before = await admin.query(
      `SELECT plan_id, created_at FROM "${schema}".tenants WHERE id=$1`,
      [tenantId],
    );
    const repo = app.get<ITenantPlanRepository>(TENANT_PLAN_REPOSITORY);
    const free = await app
      .get(TenantPlanService)
      ['planRepo'].findBySlug('free');
    const {
      TenantPlanAssignment,
    } = require('@/modules/plans/domain/tenant-plan-assignment');
    await repo.createIfMissing(
      TenantPlanAssignment.reconstitute({
        tenantId,
        plan: free,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        downgradeToPlanId: null,
        billingEmail: null,
        billingTaxId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      tenantId,
    );
    const after = await admin.query(
      `SELECT plan_id, created_at FROM "${schema}".tenants WHERE id=$1`,
      [tenantId],
    );
    expect(after).toEqual(before);
    const bill = await admin.query(
      `SELECT billing_email FROM "${schema}".tenant_billing WHERE tenant_id=$1`,
      [tenantId],
    );
    expect(bill[0].billing_email).toBe('owner@example.com');
  });
});
