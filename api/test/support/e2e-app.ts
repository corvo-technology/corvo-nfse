import { INestApplication } from '@nestjs/common';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder,
} from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { configureHttpGlobalPrefix } from '@/bootstrap-http';
import { randomUUID, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AuthIdentityService } from '@/modules/auth/application/auth-identity.service';
import { MembershipService } from '@/modules/auth/application/membership.service';
import { TenantPlanService } from '@/modules/plans/application/tenant-plan.service';

export type E2eTestApp = {
  app: INestApplication<App>;
  moduleFixture: TestingModule;
  dataSource: DataSource;
  server: App;
  adminToken: string;
  apiKey: string;
  tenantId: string;
  authUserId: string;
};

export const TEST_EMAIL = `e2e-${randomUUID()}@test.com`;

export async function createSeededE2eApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<E2eTestApp> {
  process.env.NODE_ENV = 'test';
  process.env.TURNSTILE_SECRET_KEY ??= 'test-turnstile-secret';

  const base = Test.createTestingModule({ imports: [AppModule] });
  const builder = configure ? configure(base) : base;

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureHttpGlobalPrefix(app, 'v1');

  const dataSource = moduleFixture.get(DataSource);
  if (!dataSource.isInitialized) await dataSource.initialize();

  const schema = process.env.DB_SCHEMA ?? 'corvo';
  await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await dataSource.query(`CREATE SCHEMA "${schema}"`);
  await dataSource.runMigrations();

  await app.init();
  const server = app.getHttpServer();

  // Fixtures use the current passwordless domain services. No external mail is sent.
  const { user } = await moduleFixture
    .get(AuthIdentityService)
    .findOrCreateUserByMagicLink(TEST_EMAIL);
  const authUserId = user.id;
  const tenantId = randomUUID();
  await moduleFixture.get(TenantPlanService).getOrCreate(tenantId);
  await moduleFixture.get(MembershipService).create({
    authUserId,
    tenantId,
    role: 'admin',
  });

  // Create API key DIRECTLY in DB (bypasses all guards/CSRF)
  const tokenHex = randomBytes(20).toString('hex');
  const prefix = `corvo_live_${tokenHex.substring(0, 12)}`;
  const fullKey = `corvo_live_${tokenHex}`;
  const keyHash = await argon2.hash(fullKey);

  await dataSource.query(
    `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
     VALUES ($1, $2, 'e2e-test', 'live', $3, $4, 'full_access', NOW())`,
    [randomUUID(), tenantId, prefix, keyHash],
  );

  return {
    app,
    moduleFixture,
    dataSource,
    server,
    adminToken: '', // No longer used; use apiKey for authentication
    apiKey: fullKey,
    tenantId,
    authUserId,
  };
}

export async function closeE2eApp(context?: Pick<E2eTestApp, 'app'>) {
  await context?.app?.close();
}

export function apiKeyHeader(key: string) {
  return { 'x-api-key': key };
}
