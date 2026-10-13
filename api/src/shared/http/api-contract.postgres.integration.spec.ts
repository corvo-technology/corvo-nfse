/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-require-imports */
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import {
  configureHttpTransport,
  configureHttpGlobalPrefix,
} from '@/bootstrap-http';
import { createValidationPipe } from './validation-pipe';
import { setupOpenApi } from '@/infra/openapi/setup';
import { AuthIdentityService } from '@/modules/auth/application/auth-identity.service';
import { MembershipService } from '@/modules/auth/application/membership.service';
import { CookieSessionService } from '@/modules/auth/application/cookie-session.service';
import { CookiePolicyService } from '@/modules/auth/application/cookie-policy.service';
import { ApiKeyService } from '@/modules/auth/application/api-key.service';
import type { AuthContext } from '@/modules/auth/auth-context';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
const redisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('API integration requires a local _test database');
const describeIntegration = url && redisUrl ? describe : describe.skip;
const schema = `api_contract_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const otherTenant = randomUUID();
const company = randomUUID();

describeIntegration('complete API module HTTP contract', () => {
  let db: DataSource;
  let admin: DataSource;
  let runtimeUrl: string;
  const role = `${schema}_runtime`;
  let app: NestExpressApplication;
  let key: string;
  let otherKey: string;
  let cookie: string;
  let sessionId: string;
  let userId: string;
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      DB_SCHEMA: schema,
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: schema,
      SENTRY_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      OPENAPI_ENABLED: 'true',
      RATE_LIMIT_AUTHENTICATED: '300',
      RATE_LIMIT_PUBLIC: '120',
      RATE_LIMIT_PRE_AUTH: '1200',
    });
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    admin = db;
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await admin.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
    );
    const restrictedUrl = new URL(url!);
    restrictedUrl.username = role;
    restrictedUrl.password = password;
    runtimeUrl = restrictedUrl.toString();
    db = await new DataSource(
      createTypeOrmOptions({
        url: runtimeUrl,
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
    setupOpenApi(app, app.get(ConfigService));
    await app.init();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      tenant,
      otherTenant,
    ]);
    await admin.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,tax_regime,environment) VALUES ($1,$2,'Fixture','11222333000181','MEI','test')`,
      [company, tenant],
    );
    const keys = app.get(ApiKeyService);
    key = (
      await keys.create({ activeTenantId: tenant } as AuthContext, {
        name: 'Test',
        environment: 'test',
        scope: 'full_access',
      })
    ).plaintext;
    otherKey = (
      await keys.create({ activeTenantId: otherTenant } as AuthContext, {
        name: 'Other',
        environment: 'test',
        scope: 'full_access',
      })
    ).plaintext;
    const { user } = await app
      .get(AuthIdentityService)
      .findOrCreateUserByMagicLink(`${randomUUID()}@example.invalid`);
    userId = user.id;
    await app
      .get(MembershipService)
      .create({ authUserId: user.id, tenantId: tenant, role: 'admin' });
    const created = await app.get(CookieSessionService).createSession({
      authUserId: user.id,
      activeTenantId: tenant,
      userAgent: null,
      ipHash: null,
      expiresAt: new Date(Date.now() + 3600000),
    });
    sessionId = created.session.id;
    cookie = `${app.get(CookiePolicyService).name('session')}=${created.sessionToken}`;
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
  const getKey = (path: string, credential = key) =>
    request(app.getHttpServer()).get(`/v1${path}`).set('x-api-key', credential);
  const getCookie = (path: string) =>
    request(app.getHttpServer()).get(`/v1${path}`).set('Cookie', cookie);
  it.each([
    '/companies',
    '/invoices',
    '/credits/history',
    '/credits/plans',
    '/webhooks',
    '/webhooks/deliveries',
  ])('paginates the real %s endpoint', async (path) => {
    const result = await getKey(`${path}?limit=1000`).expect(200);
    expect(result.body).toEqual({
      data: expect.any(Array),
      pagination: { limit: 1000, hasMore: false, nextCursor: null },
    });
    expect(result.headers['x-ratelimit-limit']).toBe('300');
    expect(result.headers['x-request-id']).toBeDefined();
  });
  it.each([
    '/auth/members',
    '/auth/memberships',
    '/auth/api-keys',
    '/mcp/connections',
  ])(
    'paginates session-only %s with an authenticated rate limit',
    async (path) => {
      const result = await getCookie(`${path}?limit=1`).expect(200);
      expect(result.body.pagination.limit).toBe(1);
      expect(result.headers['x-ratelimit-limit']).toBe('300');
      expect(result.body.data).toBeInstanceOf(Array);
      expect(JSON.stringify(result.body)).not.toContain('keyHash');
    },
  );
  it('paginates certificates and denies cross-tenant access', async () => {
    expect(
      (await getKey(`/companies/${company}/certificates?limit=1`).expect(200))
        .body.pagination.limit,
    ).toBe(1);
    const denied = await getKey(
      `/companies/${company}/certificates`,
      otherKey,
    ).expect(404);
    expect(denied.body.code).toBe('ERROR_CERTIFICATE_NOT_FOUND');
    expect((await getKey('/companies', otherKey)).body.data).toEqual([]);
  });
  it('paginates the public pricing catalog and rejects incompatible cursors', async () => {
    const first = await request(app.getHttpServer())
      .get('/v1/plans?limit=1')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/v1/plans')
      .query({ limit: 1, cursor: first.body.pagination.nextCursor })
      .expect(200);
    expect(first.body.data[0].slug).not.toBe(second.body.data[0].slug);
    const invalid = await getKey('/invoices')
      .query({ cursor: first.body.pagination.nextCursor })
      .expect(400);
    expect(invalid.body.code).toBe('ERROR_INVALID_CURSOR');
  });
  it('normalizes authentication, query validation and route failures', async () => {
    for (const result of [
      await request(app.getHttpServer()).get('/v1/companies').expect(401),
      await getKey('/invoices?limit=1001').expect(400),
      await getKey('/companies?page=1').expect(400),
    ]) {
      expect(result.body).toMatchObject({
        statusCode: result.status,
        code: expect.stringMatching(/^ERROR_/),
        requestId: result.headers['x-request-id'],
      });
    }
  });
  it('enforces the shared session budget after authentication', async () => {
    const { REDIS_CLIENT } = require('@/infra/redis/redis.constants');
    const redis = app.get(REDIS_CLIENT);
    const start = Date.now() - (Date.now() % 60000);
    const bucket = `${schema}:ratelimit:authenticated:session:${sessionId}:${start}`;
    await redis.set(bucket, '300', 'PX', 60000);
    const result = await getCookie('/auth/members').expect(429);
    expect(result.body.code).toBe('ERROR_RATE_LIMIT_EXCEEDED');
    expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
    await redis.del(bucket);
  });
  it('documents the contract and preserves health/discovery protocols', async () => {
    const config = app
      .get(ConfigService)
      .getOrThrow<{ jsonPath: string }>('openApi');
    const document = await request(app.getHttpServer())
      .get(`/v1/${config.jsonPath}`)
      .expect(200);
    expect(
      document.body.components.schemas.ApiErrorDto.properties.code.pattern,
    ).toBe('^ERROR_[A-Z0-9_]+$');
    expect(
      document.body.paths['/v1/companies'].get.responses['200'].content[
        'application/json'
      ].schema.properties.pagination,
    ).toBeDefined();
    const health = await request(app.getHttpServer())
      .get('/v1/health/live')
      .expect(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.data).toBeUndefined();
    expect(health.headers['x-ratelimit-limit']).toBeUndefined();
    expect(
      (
        await request(app.getHttpServer())
          .get('/.well-known/mcp.json')
          .expect(200)
      ).body.data,
    ).toBeUndefined();
  });

  it('preserves OAuth token exchange and authenticated MCP JSON-RPC', async () => {
    const { McpAuthService } = require('@/modules/mcp/mcp-auth.service');
    await db.query(
      `UPDATE "${schema}".auth_oauth_clients SET redirect_uris = ARRAY['http://localhost:9999/callback'] WHERE id = 'corvo-mcp'`,
    );
    const verifier = randomBytes(32).toString('base64url');
    const code = await app.get(McpAuthService).createAuthorizationCode({
      clientId: 'corvo-mcp',
      userId,
      tenantId: tenant,
      redirectUri: 'http://localhost:9999/callback',
      scope: 'nfse:read nfse:write',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
    });
    const token = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: 'corvo-mcp',
        redirect_uri: 'http://localhost:9999/callback',
      })
      .expect(200);
    expect(token.body.access_token).toBeDefined();
    expect(token.body.data).toBeUndefined();
    const tools = await request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
    expect(tools.body.result.tools).toBeInstanceOf(Array);
    expect(tools.body.data).toBeUndefined();
    const invoices = await request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'nfse_list', arguments: { limit: 1000 } },
      })
      .expect(200);
    expect(invoices.body.result.isError).not.toBe(true);
    expect(JSON.parse(invoices.body.result.content[0].text)).toEqual({
      invoices: [],
      next_cursor: null,
    });
    const invalid = await request(app.getHttpServer())
      .post('/v1/mcp')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
      .expect(401);
    expect(invalid.body).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32000 },
    });
    const refreshed = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: token.body.refresh_token,
        client_id: 'corvo-mcp',
      })
      .expect(200);
    expect(refreshed.body.access_token).toBeDefined();
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/mcp/revoke')
          .send({ token: refreshed.body.refresh_token, client_id: 'corvo-mcp' })
          .expect(200)
      ).body,
    ).toEqual({});
  });
  it('serves the Stripe webhook publicly from the API runtime', async () => {
    const stripe = await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .send({})
      .expect(400);
    expect(stripe.body.code).toBe('ERROR_BAD_REQUEST');
    expect(stripe.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
