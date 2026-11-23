import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';

export const ORIGIN = 'http://localhost:3000';

export type PlatformAdminHttp = {
  app: INestApplication;
  /** Owner connection: bypasses RLS, used to seed and to inspect rows. */
  owner: DataSource;
  schema: string;
  table: (name: string) => string;
  admin: { userId: string; tenantId: string; cookie: string; csrf: string };
  member: { userId: string; tenantId: string; cookie: string; csrf: string };
  unverifiedAdmin: { userId: string; cookie: string };
  apiKey: string;
  mcpToken: string;
  close: () => Promise<void>;
};

/**
 * Boots the real AppModule exactly like production wiring: the schema is built
 * by the owner role, the app connects as the restricted runtime role (RLS on,
 * no search_path), and the platform admin is picked from PLATFORM_ADMIN_EMAILS.
 * AppModule is loaded lazily because DEPLOYMENT_MODE is read at import time.
 */
export async function bootPlatformAdminApp(
  databaseUrl: string,
  mode: 'cloud' | 'self_hosted',
): Promise<PlatformAdminHttp> {
  const schema = `pa_http_${randomUUID().replaceAll('-', '')}`;
  const role = `${schema}_runtime`;
  const adminEmail = `admin-${randomUUID()}@example.com`;
  const unverifiedEmail = `unverified-${randomUUID()}@example.com`;
  const memberEmail = `member-${randomUUID()}@example.com`;
  const table = (name: string) => `"${schema}"."${name}"`;

  const owner = new DataSource(
    createTypeOrmOptions({
      url: databaseUrl,
      schema,
      ssl: false,
      logging: false,
    }),
  );
  await owner.initialize();
  await owner.query(`CREATE SCHEMA "${schema}"`);
  await owner.runMigrations();

  const password = randomBytes(24).toString('hex');
  await owner.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
  );
  const [current]: Array<{ role: string }> = await owner.query(
    'SELECT current_user AS role',
  );
  execFileSync(
    'psql',
    [
      databaseUrl,
      '-w',
      '-v',
      `runtime_role=${role}`,
      '-v',
      `migration_role=${current.role}`,
      '-v',
      `app_schema=${schema}`,
      '-f',
      resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
    ],
    { stdio: 'pipe' },
  );
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = role;
  runtimeUrl.password = password;

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DEPLOYMENT_MODE: mode,
    DATABASE_URL: runtimeUrl.toString(),
    DB_SCHEMA: schema,
    DB_SSL: 'false',
    DB_LOGGING: 'false',
    REDIS_URL: process.env.AUTH_TEST_REDIS_URL ?? 'redis://localhost:6379',
    REDIS_KEY_PREFIX: schema,
    SENTRY_ENABLED: 'false',
    OTEL_ENABLED: 'false',
    CORS_ORIGINS: ORIGIN,
    PLATFORM_ADMIN_EMAILS: ` ${adminEmail.toUpperCase()} , ${unverifiedEmail}`,
    TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
  });

  // Seed with the owner (RLS does not apply to it).
  const user = async (email: string, verified: boolean) => {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO ${table('auth_users')} (id,email,name,email_verified_at) VALUES ($1,$2,'T',${verified ? 'now()' : 'NULL'})`,
      [id, email],
    );
    return id;
  };
  const tenantFor = async (userId: string) => {
    const tenantId = randomUUID();
    await owner.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [
      tenantId,
    ]);
    await owner.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$2,'admin')`,
      [userId, tenantId],
    );
    return tenantId;
  };
  const adminUserId = await user(adminEmail, true);
  const unverifiedUserId = await user(unverifiedEmail, false);
  const memberUserId = await user(memberEmail, true);
  const adminTenantId = await tenantFor(adminUserId);
  const memberTenantId = await tenantFor(memberUserId);
  const unverifiedTenantId = await tenantFor(unverifiedUserId);

  const apiKey = `corvo_live_${randomBytes(20).toString('hex')}`;
  await owner.query(
    `INSERT INTO ${table('api_keys')} (id,tenant_id,name,environment,key_prefix,key_hash,scope)
     VALUES ($1,$2,'admin-key','live',$3,$4,'full_access')`,
    [
      randomUUID(),
      adminTenantId,
      apiKey.slice(0, 23),
      await argon2.hash(apiKey),
    ],
  );

  // Loaded only now: DEPLOYMENT_MODE (set above) is read when the modules are imported.

  const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>(
    '@/app.module',
  );
  const { configureHttpGlobalPrefix } =
    jest.requireActual<typeof import('@/bootstrap-http')>('@/bootstrap-http');
  const { createValidationPipe } = jest.requireActual<
    typeof import('@/shared/http/validation-pipe')
  >('@/shared/http/validation-pipe');
  const { mintToken } =
    jest.requireActual<typeof import('./mcp-e2e')>('./mcp-e2e');
  const { CookieSessionService } = jest.requireActual<
    typeof import('@/modules/auth/application/cookie-session.service')
  >('@/modules/auth/application/cookie-session.service');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpGlobalPrefix(app, 'v1');
  app.useGlobalPipes(createValidationPipe());
  // NODE_ENV=test turns on manualInitialization: connect as the runtime role.
  const runtime = moduleRef.get(DataSource);
  if (!runtime.isInitialized) await runtime.initialize();
  await app.init();

  const sessions = app.get(CookieSessionService);
  const session = async (authUserId: string, activeTenantId: string) => {
    const created = await sessions.createSession({
      authUserId,
      activeTenantId,
      userAgent: null,
      ipHash: null,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return {
      cookie: `gf_session_dev=${created.sessionToken}`,
      csrf: sessions.generateCsrfToken(created.session.id),
    };
  };

  const minted = await mintToken(app, {
    authUserId: adminUserId,
    tenantId: adminTenantId,
    scopes: 'nfse:read nfse:write',
  });

  return {
    app,
    owner,
    schema,
    table,
    admin: {
      userId: adminUserId,
      tenantId: adminTenantId,
      ...(await session(adminUserId, adminTenantId)),
    },
    member: {
      userId: memberUserId,
      tenantId: memberTenantId,
      ...(await session(memberUserId, memberTenantId)),
    },
    unverifiedAdmin: {
      userId: unverifiedUserId,
      ...(await session(unverifiedUserId, unverifiedTenantId)),
    },
    apiKey,
    mcpToken: minted.accessToken,
    close: async () => {
      try {
        await app.close();
      } finally {
        await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await owner.query(`DROP ROLE IF EXISTS "${role}"`);
        await owner.destroy();
        process.env = previousEnv;
      }
    },
  };
}
