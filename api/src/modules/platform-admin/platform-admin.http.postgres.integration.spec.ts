/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
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

describeReal(
  'Platform admin over real HTTP (AppModule, restricted runtime role, cloud)',
  () => {
    let ctx: PlatformAdminHttp;
    const http = () => request(ctx.app.getHttpServer());

    /** Every /v1/platform route with the verb it answers to. */
    const routes: Array<{
      method: 'get' | 'post' | 'put';
      path: () => string;
      body?: object;
    }> = [
      { method: 'get', path: () => '/v1/platform/overview' },
      { method: 'get', path: () => '/v1/platform/users' },
      {
        method: 'get',
        path: () => `/v1/platform/users/${ctx.member.userId}`,
      },
      { method: 'get', path: () => '/v1/platform/attention' },
      { method: 'get', path: () => '/v1/platform/audit' },
      {
        method: 'post',
        path: () => `/v1/platform/tenants/${ctx.member.tenantId}/credit-grants`,
      },
      {
        method: 'put',
        path: () => `/v1/platform/tenants/${ctx.member.tenantId}/nfe-access`,
        body: { enabled: true, reason: 'liberar para teste' },
      },
    ];
    const call = (
      route: (typeof routes)[number],
      headers: Record<string, string>,
    ) => {
      const req = http()[route.method](route.path()).set(headers);
      if (route.method === 'get') return req;
      return req
        .set('Idempotency-Key', randomUUID())
        .send(route.body ?? { amount: 5, reason: 'cortesia de teste' });
    };
    const cookieHeaders = (who: { cookie: string; csrf?: string }) => ({
      Cookie: who.cookie,
      Origin: ORIGIN,
      ...(who.csrf ? { 'X-CSRF-Token': who.csrf } : {}),
    });
    const auditCount = async (where: string, params: unknown[]) => {
      const rows: Array<{ n: string }> = await ctx.owner.query(
        `SELECT count(*)::text AS n FROM ${ctx.table('platform_admin_audit_events')} WHERE ${where}`,
        params,
      );
      return Number(rows[0].n);
    };

    beforeAll(async () => {
      ctx = await bootPlatformAdminApp(databaseUrl!, 'cloud');
    }, 120_000);

    afterAll(async () => {
      await ctx?.close();
    }, 30_000);

    it('sem sessão: 401 em toda rota /v1/platform', async () => {
      for (const route of routes) {
        const res = await call(route, { Origin: ORIGIN });
        expect([route.path(), res.status]).toEqual([route.path(), 401]);
      }
    });

    it('usuário comum com cookie: 404 RESOURCE_NOT_FOUND em toda rota', async () => {
      for (const route of routes) {
        const res = await call(route, cookieHeaders(ctx.member));
        expect([route.path(), res.status]).toEqual([route.path(), 404]);
        expect(res.body).toMatchObject({
          statusCode: 404,
          code: 'ERROR_RESOURCE_NOT_FOUND',
        });
      }
    });

    it('e-mail da lista mas não verificado: 404', async () => {
      for (const route of routes) {
        const res = await call(route, cookieHeaders(ctx.unverifiedAdmin));
        expect([route.path(), res.status]).toEqual([route.path(), 404]);
      }
    });

    it('chave de API do admin: 404 em toda rota (nunca 403 nem 200)', async () => {
      for (const route of routes) {
        const res = await call(route, { 'x-api-key': ctx.apiKey });
        expect([route.path(), res.status]).toEqual([route.path(), 404]);
      }
    });

    it('token MCP do admin: nunca chega ao admin (401, igual a qualquer rota fora do /mcp)', async () => {
      // Bearer tokens only authenticate /v1/mcp; on any other route the global
      // guard answers 401 before the admin guard, exactly as for /v1/companies.
      const bearer = { Authorization: `Bearer ${ctx.mcpToken}` };
      const baseline = await http().get('/v1/companies').set(bearer);
      expect(baseline.status).toBe(401);
      for (const route of routes) {
        const res = await call(route, bearer);
        expect([route.path(), res.status]).toEqual([
          route.path(),
          baseline.status,
        ]);
      }
    });

    it('nada disso gravou auditoria', async () => {
      expect(await auditCount('true', [])).toBe(0);
    });

    it('admin: leituras respondem 200 com o papel restrito de runtime (tabelas sempre qualificadas)', async () => {
      for (const route of routes.filter((r) => r.method === 'get')) {
        const res = await call(route, cookieHeaders(ctx.admin));
        expect([route.path(), res.status]).toEqual([route.path(), 200]);
      }
      const overview = await http()
        .get('/v1/platform/overview')
        .set(cookieHeaders(ctx.admin))
        .expect(200);
      expect(overview.body.data.users.total).toBeGreaterThanOrEqual(3);
    });

    it('GET /users/:id grava um user_viewed por carregamento, antes de devolver', async () => {
      const before = await auditCount(
        `action='user_viewed' AND target_user_id=$1`,
        [ctx.member.userId],
      );
      const res = await http()
        .get(`/v1/platform/users/${ctx.member.userId}`)
        .set(cookieHeaders(ctx.admin))
        .expect(200);
      expect(res.body.data.user.id).toBe(ctx.member.userId);
      expect(
        await auditCount(`action='user_viewed' AND target_user_id=$1`, [
          ctx.member.userId,
        ]),
      ).toBe(before + 1);
      await http()
        .get(`/v1/platform/users/${ctx.member.userId}`)
        .set(cookieHeaders(ctx.admin))
        .expect(200);
      expect(
        await auditCount(`action='user_viewed' AND target_user_id=$1`, [
          ctx.member.userId,
        ]),
      ).toBe(before + 2);
    });

    it('usuário inexistente ou id inválido: 404', async () => {
      await http()
        .get(`/v1/platform/users/${randomUUID()}`)
        .set(cookieHeaders(ctx.admin))
        .expect(404);
      await http()
        .get('/v1/platform/users/not-a-uuid')
        .set(cookieHeaders(ctx.admin))
        .expect(404);
    });

    it('concessão: 200, crédito bonus e auditoria juntos; repetir devolve o original; motivo não vaza em /credits/history', async () => {
      const key = randomUUID();
      const grant = () =>
        http()
          .post(`/v1/platform/tenants/${ctx.member.tenantId}/credit-grants`)
          .set(cookieHeaders(ctx.admin))
          .set('Idempotency-Key', key)
          .send({ amount: 7, reason: 'cortesia de teste' });
      const first = await grant().expect(200);
      expect(first.body.data).toMatchObject({
        tenantId: ctx.member.tenantId,
        amount: 7,
        balance: 7,
        replayed: false,
      });
      const again = await grant().expect(200);
      expect(again.body.data).toMatchObject({ balance: 7, replayed: true });

      const bonus: Array<{ n: string }> = await ctx.owner.query(
        `SELECT count(*)::text AS n FROM ${ctx.table('credit_transactions')} WHERE tenant_id=$1 AND type='bonus'`,
        [ctx.member.tenantId],
      );
      expect(Number(bonus[0].n)).toBe(1);
      expect(
        await auditCount(`action='credit_grant' AND success=true`, []),
      ).toBe(1);

      const history = await http()
        .get('/v1/credits/history')
        .set(cookieHeaders(ctx.member))
        .expect(200);
      const text = JSON.stringify(history.body);
      expect(text).not.toContain('cortesia de teste');
      expect(text).not.toContain('example.com');
    });

    it('liberação de NF-e: liga e desliga a coluna com a auditoria; o contexto da sessão acompanha', async () => {
      const put = (body: object) =>
        http()
          .put(`/v1/platform/tenants/${ctx.member.tenantId}/nfe-access`)
          .set(cookieHeaders(ctx.admin))
          .send(body);
      const column = async () => {
        const rows: Array<{ nfe_enabled_at: Date | null }> =
          await ctx.owner.query(
            `SELECT nfe_enabled_at FROM ${ctx.table('tenants')} WHERE id=$1`,
            [ctx.member.tenantId],
          );
        return rows[0].nfe_enabled_at;
      };
      const features = async () =>
        (
          await http()
            .get('/v1/auth/session')
            .set({ Cookie: ctx.member.cookie })
            .expect(200)
        ).body.data.features;

      expect(await column()).toBeNull();
      const on = await put({ enabled: true, reason: 'liberar para teste' });
      expect(on.status).toBe(200);
      expect(on.body.data).toMatchObject({
        tenantId: ctx.member.tenantId,
        enabled: true,
      });
      expect(await column()).not.toBeNull();
      expect(
        await auditCount(
          `action='nfe_access_changed' AND target_tenant_id=$1 AND success=true`,
          [ctx.member.tenantId],
        ),
      ).toBe(1);
      // With the global flag off (the default of this test app) the session never offers NF-e.
      expect(await features()).toEqual({ nfe: false });

      const off = await put({ enabled: false, reason: 'fim do teste de NF-e' });
      expect(off.body.data).toMatchObject({ enabled: false, enabledAt: null });
      expect(await column()).toBeNull();
      expect(await auditCount(`action='nfe_access_changed'`, [])).toBe(2);
    });

    it('liberação de NF-e: motivo curto, corpo sem boolean ou tenant inexistente não gravam nada', async () => {
      const before = await auditCount(`action='nfe_access_changed'`, []);
      await http()
        .put(`/v1/platform/tenants/${ctx.member.tenantId}/nfe-access`)
        .set(cookieHeaders(ctx.admin))
        .send({ enabled: true, reason: 'x' })
        .expect(400);
      await http()
        .put(`/v1/platform/tenants/${ctx.member.tenantId}/nfe-access`)
        .set(cookieHeaders(ctx.admin))
        .send({ enabled: 'sim', reason: 'motivo válido' })
        .expect(400);
      await http()
        .put(`/v1/platform/tenants/${randomUUID()}/nfe-access`)
        .set(cookieHeaders(ctx.admin))
        .send({ enabled: true, reason: 'motivo válido' })
        .expect(404);
      expect(await auditCount(`action='nfe_access_changed'`, [])).toBe(before);
    });

    it('concessão sem Idempotency-Key ou com corpo inválido não grava crédito', async () => {
      await http()
        .post(`/v1/platform/tenants/${ctx.member.tenantId}/credit-grants`)
        .set(cookieHeaders(ctx.admin))
        .send({ amount: 5, reason: 'cortesia de teste' })
        .expect(400);
      await http()
        .post(`/v1/platform/tenants/${ctx.member.tenantId}/credit-grants`)
        .set(cookieHeaders(ctx.admin))
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 501, reason: 'cortesia de teste' })
        .expect(400);
    });
  },
);
