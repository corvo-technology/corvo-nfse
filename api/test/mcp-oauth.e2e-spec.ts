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
  extractSetCookie,
} from './support/mcp-e2e';

jest.setTimeout(180_000);

describe('MCP OAuth authorization-code + PKCE flow (e2e)', () => {
  let ctx: E2eTestApp;
  let app: INestApplication;
  let dataSource: DataSource;
  let sessionToken: string;
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
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  const sessionCookie = (): string => `corvo_session=${sessionToken}`;

  /** Drive authorize → consent and return the resulting code + PKCE pair. */
  async function authorizeAndConsent(): Promise<{
    code: string;
    verifier: string;
    challenge: string;
    state: string;
  }> {
    const { verifier, challenge } = pkcePair();
    const state = randomUUID();

    const qs = new URLSearchParams({
      client_id: 'corvo-mcp',
      redirect_uri: MCP_REDIRECT_URI,
      response_type: 'code',
      scope: MCP_SCOPE_FULL,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString();

    const authorize = await request(app.getHttpServer())
      .get(`/v1/mcp/authorize?${qs}`)
      .redirects(0)
      .expect(302);

    expect(authorize.headers.location).toContain('/v1/mcp/consent');
    const stateCookie = extractSetCookie(
      authorize.headers['set-cookie'],
      'mcp_oauth_state',
    );
    expect(stateCookie).toBe(state);

    const consent = await request(app.getHttpServer())
      .post('/v1/mcp/consent')
      .set('Cookie', [sessionCookie(), `mcp_oauth_state=${state}`])
      .type('form')
      .send({
        selected_tenant_id: tenantId,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        redirect_uri: MCP_REDIRECT_URI,
        scope: MCP_SCOPE_FULL,
        client_id: 'corvo-mcp',
      })
      .redirects(0)
      .expect(302);

    const target = new URL(consent.headers.location);
    const code = target.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(target.searchParams.get('state')).toBe(state);

    return { code: code as string, verifier, challenge, state };
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
    await request(app.getHttpServer())
      .delete(`/v1/mcp/connections/${connectionId}`)
      .set('Cookie', sessionCookie())
      .expect(200);

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
});
