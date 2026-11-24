import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { EmailService } from '@/modules/email/application/email.service';
import { TenantMembershipOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-membership.orm-entity';
import { PasswordlessWorkspaceService } from '../application/passwordless-workspace.service';
import { AuthUserOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const redisUrl = process.env.AUTH_TEST_REDIS_URL;
const describeReal = databaseUrl && redisUrl ? describe : describe.skip;
const schema = `CorvoAuth_${randomUUID().replaceAll('-', '')}`;

type FrontendResponse = {
  data: {
    challengeId: string;
    csrfToken: string;
    isNewUser: boolean;
    availableTenants: unknown[];
    context: { role: string };
    plan: { slug: string };
    apiKey: Record<string, unknown>;
    plaintext: string;
  };
};
const payload = (response: { body: unknown }): FrontendResponse =>
  response.body as FrontendResponse;

describeReal('Passwordless HTTP with real PostgreSQL and Redis', () => {
  let app: INestApplication;
  let db: DataSource;
  let challengeId: string;
  let cookie: string;
  let csrfToken: string;
  const email = `frontend-${randomUUID()}@example.com`;
  const origin = 'http://localhost:3000';
  const delivery = jest.fn<Promise<void>, [{ to: string; code: string }]>();
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    ) {
      throw new Error('Use a local test database ending in _test');
    }
    const redis = new URL(redisUrl!);
    if (!['localhost', '127.0.0.1'].includes(redis.hostname))
      throw new Error('Use local Redis');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      DB_SCHEMA: schema,
      DB_SSL: 'false',
      DB_LOGGING: 'false',
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: schema,
      SENTRY_ENABLED: 'false',
      OTEL_ENABLED: 'false',
      CORS_ORIGINS: origin,
    });
    const setup = new DataSource(
      createTypeOrmOptions({
        url: databaseUrl!,
        schema,
        ssl: false,
        logging: false,
      }),
    );
    await setup.initialize();
    db = setup;
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.runMigrations();
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>(
      '@/app.module',
    );
    delivery.mockResolvedValue();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(EmailService)
      .useValue({
        enqueueOtp: delivery,
        enqueueWelcome: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  }, 60_000);

  afterAll(async () => {
    const cleanup = db?.isInitialized
      ? db
      : new DataSource(
          createTypeOrmOptions({
            url: databaseUrl!,
            schema,
            ssl: false,
            logging: false,
          }),
        );
    try {
      if (!cleanup.isInitialized) await cleanup.initialize();
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      if (cleanup !== db && cleanup.isInitialized) await cleanup.destroy();
      await app?.close();
      if (db?.isInitialized) await db.destroy();
      process.env = previousEnv;
    }
  }, 20_000);

  it('requests a code at /v1, returns a challenge without secrets, and enforces cooldown', async () => {
    const issued = await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/request')
      .send({ email })
      .expect(200);
    challengeId = payload(issued).data.challengeId;
    expect(challengeId).toBeTruthy();
    expect(payload(issued).data).not.toHaveProperty('code');
    expect(delivery).toHaveBeenCalledTimes(1);
    const cooldown = await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/request')
      .send({ email })
      .expect(429);
    expect(cooldown.headers['retry-after']).toBeTruthy();
  });

  it('rejects wrong email, wrong code and missing challenge before creating an account', async () => {
    await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/verify')
      .send({ email, code: '123456' })
      .expect(400);
    const code = delivery.mock.calls[0][0].code;
    await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/verify')
      .send({ email: 'other@example.com', code, challengeId })
      .expect(401);
    const wrongCode = code === '000000' ? '000001' : '000000';
    await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/verify')
      .send({ email, code: wrongCode, challengeId })
      .expect(401);
    expect(await db.getRepository(AuthUserOrmEntity).count()).toBe(0);
  });

  it('verifies once, provisions a free workspace, and authenticates frontend requests by cookie', async () => {
    const body = { email, challengeId, code: delivery.mock.calls[0][0].code };
    const verified = await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/verify')
      .send(body)
      .expect(200);
    expect(payload(verified).data.isNewUser).toBe(true);
    csrfToken = payload(verified).data.csrfToken;
    cookie = verified.headers['set-cookie'][0].split(';')[0];
    expect(cookie).toMatch(/^gf_session_dev=/);
    const session = await request(app.getHttpServer<Server>())
      .get('/v1/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(payload(session).data.csrfToken).toBe(csrfToken);
    expect(payload(session).data.availableTenants).toHaveLength(1);
    expect(payload(session).data.context.role).toBe('admin');
    const billing = await request(app.getHttpServer<Server>())
      .get('/v1/billing/plan')
      .set('Cookie', cookie)
      .expect(200);
    expect(payload(billing).data.plan.slug).toBe('free');
    await request(app.getHttpServer<Server>())
      .post('/v1/auth/magic-link/verify')
      .send(body)
      .expect(401);
    const user = await db
      .getRepository(AuthUserOrmEntity)
      .findOneByOrFail({ email });
    await Promise.all([
      app.get(PasswordlessWorkspaceService).ensureWorkspace(user),
      app.get(PasswordlessWorkspaceService).ensureWorkspace(user),
    ]);
    expect(await db.getRepository(TenantMembershipOrmEntity).count()).toBe(1);
  });

  it('keeps private routes protected and registers API keys without exposing key hashes', async () => {
    for (const path of [
      '/v1/companies',
      '/v1/invoices',
      '/v1/companies/00000000-0000-4000-8000-000000000000/certificates',
      '/v1/auth/api-keys',
    ]) {
      await request(app.getHttpServer<Server>()).get(path).expect(401);
      await request(app.getHttpServer<Server>())
        .get('/v1' + path)
        .expect(404);
    }
    const body = {
      name: 'Frontend test',
      environment: 'test',
      scope: 'full_access',
    };
    await request(app.getHttpServer<Server>())
      .post('/v1/auth/api-keys')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(403);
    const created = await request(app.getHttpServer<Server>())
      .post('/v1/auth/api-keys')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', csrfToken)
      .send(body)
      .expect(201);
    expect(payload(created).data.apiKey).not.toHaveProperty('keyHash');
    expect(payload(created).data.plaintext).toBeTruthy();
    await request(app.getHttpServer<Server>())
      .get('/v1/companies')
      .set('x-api-key', payload(created).data.plaintext)
      .expect(200);
  });

  it('revokes the session on logout and clears the same cookie issued by login', async () => {
    const response = await request(app.getHttpServer<Server>())
      .post('/v1/auth/session/logout')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', csrfToken)
      .expect(204);
    expect(response.headers['set-cookie'][0]).toMatch(/^gf_session_dev=;/);
    await request(app.getHttpServer<Server>())
      .get('/v1/auth/session')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('does not recreate inactive memberships or grant a second free note for the same person', async () => {
    const user = await db
      .getRepository(AuthUserOrmEntity)
      .findOneByOrFail({ email });
    await db
      .getRepository(TenantMembershipOrmEntity)
      .update({ authUserId: user.id }, { isActive: false });
    await expect(
      app.get(PasswordlessWorkspaceService).ensureWorkspace(user),
    ).rejects.toThrow('Tenant membership is inactive');
    // The same person again with an alias (`+tag`) gets a workspace of their own, but the
    // first free note was already claimed by `email`, so no second note is granted.
    const other = await db.getRepository(AuthUserOrmEntity).save({
      id: randomUUID(),
      email: email.replace('@', '+again@'),
      name: 'Test',
    });
    await app.get(PasswordlessWorkspaceService).ensureWorkspace(other);
    expect(await db.getRepository(TenantOrmEntity).count()).toBe(2);
    expect(await db.getRepository(TenantMembershipOrmEntity).count()).toBe(2);
    const freeNotes = (tenantId: string) =>
      db.query(
        `SELECT 1 FROM "${schema}".credit_transactions WHERE tenant_id=$1 AND type='bonus'`,
        [tenantId],
      );
    expect(await freeNotes(user.id)).toHaveLength(1);
    expect(await freeNotes(other.id)).toHaveLength(0);
  });
});
