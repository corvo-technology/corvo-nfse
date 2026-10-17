/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createSeededE2eApp,
  closeE2eApp,
  type E2eTestApp,
} from './support/e2e-app';
import { CookieSessionService } from '@/modules/auth/application/cookie-session.service';
import {
  AuthOAuthClientOrmEntity,
  AuthSessionOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { McpConnectionOrmEntity } from '@/modules/mcp/infra/mcp-connection.orm-entity';
import {
  MCP_REDIRECT_URI,
  MCP_SCOPE_FULL,
  pkcePair,
  sha256Hex,
  decodeJwtPayload,
} from './support/mcp-e2e';

jest.setTimeout(180_000);

describe('MCP OAuth authorization-code + PKCE flow (e2e)', () => {
  let ctx: E2eTestApp;
  let app: INestApplication;
  let dataSource: DataSource;
  let sessionToken: string;
  let csrfToken: string;
  let tenantId: string;
  let authUserId: string;

  beforeAll(async () => {
    // The seeded corvo-mcp client reads its redirect URIs from this env var at
    // boot. Set it defensively; we also re-point the client explicitly below.
    process.env.MCP_REDIRECT_URIS ??= MCP_REDIRECT_URI;

    ctx = await createSeededE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    tenantId = ctx.tenantId;
    authUserId = ctx.authUserId;

    // Guarantee the OAuth client is active and has our test redirect URI
    // registered, regardless of how it was seeded.
    await dataSource
      .getRepository(AuthOAuthClientOrmEntity)
      .update(
        { id: 'corvo-mcp' },
        { redirectUris: [MCP_REDIRECT_URI], isActive: true },
      );

    // Create a real browser (web) session for the user to carry as a cookie.
    const sessions = app.get(CookieSessionService);
    const created = await sessions.createSession({
      authUserId,
      activeTenantId: tenantId,
      userAgent: 'mcp-e2e',
      ipHash: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionToken = created.sessionToken;
    csrfToken = sessions.generateCsrfToken(created.session.id);
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  const sessionCookie = (): string => `gf_session_dev=${sessionToken}`;
  /** Browser-like call from the dashboard (cookie + origin + CSRF). */
  const dashboard = (method: 'get' | 'post' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', sessionCookie())
      .set('Origin', 'http://localhost:4000')
      .set('X-CSRF-Token', csrfToken);

  function authorizeQuery(
    overrides: Record<string, string> = {},
    pkce = pkcePair(),
  ) {
    return {
      pkce,
      params: {
        client_id: 'corvo-mcp',
        redirect_uri: MCP_REDIRECT_URI,
        response_type: 'code',
        scope: MCP_SCOPE_FULL,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        state: randomUUID(),
        ...overrides,
      },
    };
  }

  /** Drive authorize → dashboard consent and return the resulting code + PKCE pair. */
  async function authorizeAndConsent(
    overrides: Record<string, string> = {},
  ): Promise<{
    code: string;
    verifier: string;
    challenge: string;
    state: string;
  }> {
    const { pkce, params } = authorizeQuery(overrides);
    const qs = new URLSearchParams(params).toString();

    const authorize = await request(app.getHttpServer())
      .get(`/v1/mcp/authorize?${qs}`)
      .redirects(0)
      .expect(302);

    // Login and consent live on the dashboard, not on the API origin.
    const location = new URL(authorize.headers.location);
    expect(location.pathname).toBe('/mcp/authorize');
    expect(location.searchParams.get('state')).toBe(params.state);
    expect(location.searchParams.get('client_id')).toBe(params.client_id);

    const context = await dashboard('get', `/v1/mcp/consent?${qs}`).expect(200);
    expect(context.body.data.tenants).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tenantId })]),
    );

    const consent = await dashboard('post', '/v1/mcp/consent')
      .send({ ...params, decision: 'allow', tenant_id: tenantId })
      .expect(200);

    const target = new URL(consent.body.data.redirect_url);
    const code = target.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(target.searchParams.get('state')).toBe(params.state);

    return {
      code: code as string,
      verifier: pkce.verifier,
      challenge: pkce.challenge,
      state: params.state,
    };
  }

  it('completes authorize → consent → token, verifying JWT, session and connection rows', async () => {
    const { code, verifier } = await authorizeAndConsent();

    const tokenRes = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: MCP_REDIRECT_URI,
        client_id: 'corvo-mcp',
      })
      .expect(200);

    const { access_token, refresh_token, token_type, expires_in, scope } =
      tokenRes.body;
    expect(token_type).toBe('Bearer');
    expect(expires_in).toBe(900);
    expect(scope).toBe(MCP_SCOPE_FULL);
    expect(access_token).toBeTruthy();
    expect(refresh_token).toBeTruthy();

    // JWT payload contract.
    const payload = decodeJwtPayload(access_token);
    expect(payload.sub).toBe(authUserId);
    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.aud).toBe('corvo-mcp');
    expect(payload.scopes).toEqual(
      expect.arrayContaining(['nfse:read', 'nfse:write']),
    );
    const connectionId = String(payload.connection_id);
    expect(connectionId).toBeTruthy();

    // auth_sessions row: kind=oauth_refresh, hashed refresh token, active tenant.
    const sessionRow = await dataSource
      .getRepository(AuthSessionOrmEntity)
      .findOne({ where: { refreshTokenHash: sha256Hex(refresh_token) } });
    expect(sessionRow).toBeTruthy();
    expect(sessionRow!.kind).toBe('oauth_refresh');
    expect(sessionRow!.clientId).toBe('corvo-mcp');
    expect(sessionRow!.activeTenantId).toBe(tenantId);
    expect(sessionRow!.revokedAt).toBeNull();

    // mcp_connections row exists and is bound to the session.
    const connection = await dataSource
      .getRepository(McpConnectionOrmEntity)
      .findOne({ where: { id: connectionId } });
    expect(connection).toBeTruthy();
    expect(connection!.tenantId).toBe(tenantId);
    expect(connection!.authUserId).toBe(authUserId);
    expect(connection!.sessionId).toBe(sessionRow!.id);
    expect(connection!.scopes).toEqual(
      expect.arrayContaining(['nfse:read', 'nfse:write']),
    );
    expect(connection!.revokedAt).toBeNull();
  });

  it('rotates refresh tokens and invalidates the old one', async () => {
    const { code, verifier } = await authorizeAndConsent();

    const first = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: MCP_REDIRECT_URI,
        client_id: 'corvo-mcp',
      })
      .expect(200);
    const oldRefresh = first.body.refresh_token as string;

    const refreshed = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({ grant_type: 'refresh_token', refresh_token: oldRefresh })
      .expect(200);
    const newRefresh = refreshed.body.refresh_token as string;
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);
    expect(refreshed.body.access_token).toBeTruthy();

    // Old refresh token is now dead.
    const reuse = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({ grant_type: 'refresh_token', refresh_token: oldRefresh })
      .expect(400);
    expect(reuse.body.error).toBe('invalid_grant');

    // New refresh token still works.
    await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({ grant_type: 'refresh_token', refresh_token: newRefresh })
      .expect(200);
  });

  it('rejects a wrong PKCE code_verifier with invalid_grant', async () => {
    const { code } = await authorizeAndConsent();

    const res = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'this-is-not-the-right-verifier',
        redirect_uri: MCP_REDIRECT_URI,
        client_id: 'corvo-mcp',
      })
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('revoking a connection revokes the backing session and kills refresh', async () => {
    const { code, verifier } = await authorizeAndConsent();

    const tokenRes = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: MCP_REDIRECT_URI,
        client_id: 'corvo-mcp',
      })
      .expect(200);
    const refreshToken = tokenRes.body.refresh_token as string;
    const connectionId = String(
      decodeJwtPayload(tokenRes.body.access_token as string).connection_id,
    );

    // Revoke via the dashboard API using the browser session cookie.
    await dashboard('delete', `/v1/mcp/connections/${connectionId}`).expect(
      200,
    );

    // Backing auth session is revoked.
    const sessionRow = await dataSource
      .getRepository(AuthSessionOrmEntity)
      .findOne({ where: { refreshTokenHash: sha256Hex(refreshToken) } });
    expect(sessionRow).toBeTruthy();
    expect(sessionRow!.revokedAt).toBeTruthy();

    // Connection row is revoked.
    const connection = await dataSource
      .getRepository(McpConnectionOrmEntity)
      .findOne({ where: { id: connectionId } });
    expect(connection!.revokedAt).toBeTruthy();

    // Subsequent refresh fails with invalid_grant.
    const refresh = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken })
      .expect(400);
    expect(refresh.body.error).toBe('invalid_grant');
  });

  it('serves OAuth discovery documents that point at the MCP endpoints', async () => {
    const server = await request(app.getHttpServer())
      .get('/.well-known/oauth-authorization-server')
      .expect(200);
    expect(server.body.authorization_endpoint).toMatch(/\/mcp\/authorize$/);
    expect(server.body.token_endpoint).toMatch(/\/mcp\/token$/);
    expect(server.body.registration_endpoint).toMatch(/\/mcp\/register$/);
    expect(server.body.code_challenge_methods_supported).toEqual(['S256']);

    const resource = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource')
      .expect(200);
    expect(resource.body.resource).toMatch(/\/mcp$/);
    expect(resource.body.authorization_servers).toHaveLength(1);

    await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource/mcp')
      .expect(200);

    // The address given to agents has no version prefix; /v1/mcp keeps working.
    const bare = await request(app.getHttpServer())
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
      .expect(401);
    expect(bare.headers['www-authenticate']).toContain('resource_metadata');
    await request(app.getHttpServer())
      .post('/mcp/register')
      .send({ redirect_uris: ['http://evil.example.com/cb'] })
      .expect(400);
  });

  it('points unauthenticated MCP calls at the resource metadata', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
      .expect(401);
    expect(res.headers['www-authenticate']).toContain(
      '/.well-known/oauth-protected-resource',
    );
  });

  it('registers a client dynamically and completes the flow with a loopback port that changed', async () => {
    const registered = await request(app.getHttpServer())
      .post('/v1/mcp/register')
      .send({
        client_name: 'Claude Code',
        redirect_uris: ['http://localhost:7001/callback'],
      })
      .expect(201);
    const clientId = registered.body.client_id as string;
    expect(clientId).toMatch(/^corvo-mcp-/);
    expect(registered.body.token_endpoint_auth_method).toBe('none');

    const redirectUri = 'http://localhost:7002/callback';
    const { code, verifier } = await authorizeAndConsent({
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    const tokens = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
      })
      .expect(200);

    const list = await dashboard('get', '/v1/mcp/connections').expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_name: 'Claude Code',
          mine: true,
          tool_calls: 0,
          revoked: false,
        }),
      ]),
    );

    // The new token reaches the MCP endpoint and usage is recorded.
    await request(app.getHttpServer())
      .post('/v1/mcp')
      .set('Authorization', `Bearer ${tokens.body.access_token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
    const connectionId = String(
      decodeJwtPayload(tokens.body.access_token as string).connection_id,
    );
    const row = await dataSource
      .getRepository(McpConnectionOrmEntity)
      .findOneOrFail({ where: { id: connectionId } });
    expect(row.lastUsedAt).toBeTruthy();
    expect(row.toolCallsCount).toBe(0);
  });

  it('connects in live when the user picks live and lists the environment', async () => {
    const registered = await request(app.getHttpServer())
      .post('/v1/mcp/register')
      .send({
        client_name: 'Live agent',
        redirect_uris: ['http://localhost:7100/callback'],
      })
      .expect(201);
    const clientId = registered.body.client_id as string;
    const redirectUri = 'http://localhost:7100/callback';
    const { pkce, params } = authorizeQuery({
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    const consent = await dashboard('post', '/v1/mcp/consent')
      .send({
        ...params,
        decision: 'allow',
        tenant_id: tenantId,
        environment: 'live',
      })
      .expect(200);
    const code = new URL(consent.body.data.redirect_url).searchParams.get(
      'code',
    );

    const tokens = await request(app.getHttpServer())
      .post('/v1/mcp/token')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
      })
      .expect(200);
    const connectionId = String(
      decodeJwtPayload(tokens.body.access_token as string).connection_id,
    );
    const row = await dataSource
      .getRepository(McpConnectionOrmEntity)
      .findOneOrFail({ where: { id: connectionId } });
    expect(row.environment).toBe('live');

    const list = await dashboard('get', '/v1/mcp/connections').expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_name: 'Live agent',
          environment: 'live',
        }),
      ]),
    );
  });

  it('rejects registrations with unsafe redirect URIs', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/mcp/register')
      .send({ redirect_uris: ['http://evil.example.com/cb'] })
      .expect(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('returns access_denied to the app when the user denies', async () => {
    const { params } = authorizeQuery();
    const res = await dashboard('post', '/v1/mcp/consent')
      .send({ ...params, decision: 'deny' })
      .expect(200);
    const target = new URL(res.body.data.redirect_url);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.get('state')).toBe(params.state);
    expect(target.searchParams.get('code')).toBeNull();
  });

  it('refuses consent without a logged-in session and for unregistered redirect URIs', async () => {
    const { params } = authorizeQuery();
    await request(app.getHttpServer())
      .get(`/v1/mcp/consent?${new URLSearchParams(params).toString()}`)
      .expect(401);

    const bad = authorizeQuery({ redirect_uri: 'http://localhost:9999/other' });
    await dashboard(
      'get',
      `/v1/mcp/consent?${new URLSearchParams(bad.params).toString()}`,
    ).expect(400);
  });

  it('reconnecting the same app reuses its connection instead of failing', async () => {
    const first = await authorizeAndConsent();
    const second = await authorizeAndConsent();
    for (const { code, verifier } of [first, second]) {
      await request(app.getHttpServer())
        .post('/v1/mcp/token')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: MCP_REDIRECT_URI,
          client_id: 'corvo-mcp',
        })
        .expect(200);
    }
    const rows = await dataSource
      .getRepository(McpConnectionOrmEntity)
      .find({ where: { authUserId, tenantId, clientId: 'corvo-mcp' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });
});
