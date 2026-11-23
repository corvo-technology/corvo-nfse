/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  bootPlatformAdminApp,
  ORIGIN,
  type PlatformAdminHttp,
} from '../../../test/support/platform-admin-http';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  databaseUrl &&
  (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
    !new URL(databaseUrl).pathname.endsWith('_test'))
)
  throw new Error('Platform admin HTTP spec requires a local _test database');
const describeReal = databaseUrl ? describe : describe.skip;

jest.setTimeout(120_000);

describeReal('Platform admin in self-hosted mode (real AppModule boot)', () => {
  let ctx: PlatformAdminHttp;
  const http = () => request(ctx.app.getHttpServer());
  const headers = () => ({
    Cookie: ctx.admin.cookie,
    Origin: ORIGIN,
    'X-CSRF-Token': ctx.admin.csrf,
  });

  beforeAll(async () => {
    ctx = await bootPlatformAdminApp(databaseUrl!, 'self_hosted');
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  }, 30_000);

  it('o app sobe com todos os providers do admin resolvidos', () => {
    expect(ctx.app).toBeDefined();
  });

  it('a concessão não existe: 404, e nada é gravado', async () => {
    await http()
      .post(`/v1/platform/tenants/${ctx.member.tenantId}/credit-grants`)
      .set(headers())
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 5, reason: 'cortesia de teste' })
      .expect(404);
    const rows: Array<{ n: string }> = await ctx.owner.query(
      `SELECT count(*)::text AS n FROM ${ctx.table('credit_transactions')} WHERE type='bonus'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('usuários, atenção e histórico continuam para o admin', async () => {
    for (const path of [
      '/v1/platform/overview',
      '/v1/platform/users',
      `/v1/platform/users/${ctx.member.userId}`,
      '/v1/platform/attention',
      '/v1/platform/audit',
    ]) {
      const res = await http().get(path).set(headers());
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  it('usuário comum continua recebendo 404', async () => {
    await http()
      .get('/v1/platform/users')
      .set({ Cookie: ctx.member.cookie, Origin: ORIGIN })
      .expect(404);
  });
});
