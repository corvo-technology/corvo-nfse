import { createHash, randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import * as sentry from '@/infra/observability/sentry-reporter';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
import type { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import type { OAuthAuthorizationCode } from '../auth/domain/oauth-authorization-code';
import type { AuthSession } from '../auth/domain/auth-session';
import type { McpConnection } from './domain/mcp-connection';
import { McpAuthService, verifyCodeChallenge } from './mcp-auth.service';

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const base64urlSha256 = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const CLIENT_ID = 'corvo-mcp';
const REDIRECT_URI = 'http://localhost:3000/mcp/callback';
const SCOPE = 'nfse:read nfse:write';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CODE_VERIFIER = 'test-code-verifier-abcdefghijklmnopqrstuvwxyz012345';
const CODE_CHALLENGE = base64urlSha256(CODE_VERIFIER);

function createInMemoryRepos() {
  const codes: OAuthAuthorizationCode[] = [];
  const sessions: AuthSession[] = [];
  const connections: McpConnection[] = [];
  const codesRepo = {
    findActiveByCodeHash: jest.fn(
      async (hash: string) =>
        codes.find(
          (row) =>
            row.codeHash === hash &&
            !row.consumedAt &&
            row.expiresAt > new Date(),
        ) ?? null,
    ),
    save: jest.fn(async (code: OAuthAuthorizationCode) => {
      codes.push(code);
      return code;
    }),
    consume: jest.fn(async (id: string, userId: string, tenantId: string) => {
      const code = codes.find(
        (row) =>
          row.id === id &&
          row.authUserId === userId &&
          row.tenantId === tenantId &&
          !row.consumedAt &&
          row.expiresAt > new Date(),
      );
      if (!code) return false;
      code.consumedAt = new Date();
      return true;
    }),
  };
  const sessionsRepo = {
    findActiveById: jest.fn(
      async (id: string) =>
        sessions.find(
          (row) =>
            row.id === id && !row.revokedAt && row.expiresAt > new Date(),
        ) ?? null,
    ),
    findActiveByRefreshTokenHash: jest.fn(
      async (hash: string) =>
        sessions.find(
          (row) =>
            row.refreshTokenHash === hash &&
            !row.revokedAt &&
            row.expiresAt > new Date(),
        ) ?? null,
    ),
    save: jest.fn(async (session: AuthSession) => {
      sessions.push(session);
      return session;
    }),
    rotateRefreshToken: jest.fn(
      async (
        id: string,
        tenantId: string,
        userId: string,
        clientId: string,
        previousHash: string,
        nextHash: string,
        _now?: Date,
        nextExpiresAt?: Date,
      ) => {
        const session = sessions.find(
          (row) =>
            row.id === id &&
            row.activeTenantId === tenantId &&
            row.authUserId === userId &&
            row.clientId === clientId &&
            row.kind === 'oauth_refresh' &&
            !row.revokedAt &&
            row.refreshTokenHash === previousHash &&
            row.expiresAt > new Date(),
        );
        if (!session) return false;
        session.refreshTokenHash = nextHash;
        if (nextExpiresAt) session.expiresAt = nextExpiresAt;
        return true;
      },
    ),
    revokeOAuthSession: jest.fn(
      async (
        id: string,
        tenantId: string,
        userId: string,
        clientId: string,
      ) => {
        const session = sessions.find(
          (row) =>
            row.id === id &&
            row.activeTenantId === tenantId &&
            row.authUserId === userId &&
            row.clientId === clientId &&
            row.kind === 'oauth_refresh' &&
            !row.revokedAt,
        );
        if (session) session.revokedAt = new Date();
      },
    ),
  };
  const connectionsRepo = {
    insert: jest.fn(async (connection: McpConnection) => {
      connections.push(connection);
    }),
    findBySession: jest.fn(
      async (
        sessionId: string,
        tenantId: string,
        userId: string,
        clientId: string,
      ) =>
        connections.find(
          (row) =>
            row.sessionId === sessionId &&
            row.tenantId === tenantId &&
            row.authUserId === userId &&
            row.clientId === clientId,
        ) ?? null,
    ),
    findAnyByUserTenantClient: jest.fn(
      async (userId: string, tenantId: string, clientId: string) =>
        connections.find(
          (row) =>
            row.authUserId === userId &&
            row.tenantId === tenantId &&
            row.clientId === clientId,
        ) ?? null,
    ),
    reconnect: jest.fn(
      async (
        id: string,
        _tenantId: string,
        next: { sessionId: string; scopes: string[] },
      ) => {
        const row = connections.find((item) => item.id === id)!;
        row.sessionId = next.sessionId;
        row.scopes = next.scopes;
        row.environment = next.environment;
        row.revokedAt = null;
        return row;
      },
    ),
    findByIdAndOwner: jest.fn(
      async (id: string, tenantId: string, userId: string) =>
        connections.find(
          (row) =>
            row.id === id &&
            row.tenantId === tenantId &&
            row.authUserId === userId,
        ) ?? null,
    ),
  };
  return {
    codes,
    sessions,
    connections,
    codesRepo,
    sessionsRepo,
    connectionsRepo,
  };
}

function createHarness(audit: AccountAuditRecorder = new FakeAccountAudit()) {
  const repos = createInMemoryRepos();
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      jwtSecret: 'a'.repeat(32),
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      authorizationCodeTtlSeconds: 300,
      csrfSigningSecret: 'b'.repeat(32),
    }),
  };
  const memberships = {
    findByAuthUserAndTenant: jest.fn().mockResolvedValue({ isActive: true }),
  };
  const eventBus = { publishBestEffort: jest.fn() };
  const service = new McpAuthService(
    repos.codesRepo as never,
    repos.sessionsRepo as never,
    repos.connectionsRepo as never,
    config as never,
    memberships as never,
    { findById: jest.fn().mockResolvedValue({ name: 'Claude' }) } as never,
    eventBus as never,
    audit,
  );
  return {
    service,
    config,
    memberships,
    eventBus,
    audit: audit as FakeAccountAudit,
    ...repos,
  };
}

function seedCode(
  codes: OAuthAuthorizationCode[],
  overrides: Partial<OAuthAuthorizationCode> = {},
): { raw: string; code: OAuthAuthorizationCode } {
  const raw = 'raw-auth-code-abcdefghij0123456789abcd';
  const code = {
    id: randomUUID(),
    clientId: CLIENT_ID,
    authUserId: USER_ID,
    productKey: 'corvo',
    codeHash: sha256(raw),
    codeChallenge: CODE_CHALLENGE,
    codeChallengeMethod: 'S256',
    redirectUri: REDIRECT_URI,
    scope: SCOPE,
    environment: 'test',
    tenantId: TENANT_ID,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OAuthAuthorizationCode;
  codes.push(code);
  return { raw, code };
}

async function exchange(
  harness: ReturnType<typeof createHarness>,
  raw: string,
  overrides: {
    codeVerifier?: string;
    redirectUri?: string;
    clientId?: string;
  } = {},
) {
  return harness.service.exchangeCode({
    code: raw,
    codeVerifier: overrides.codeVerifier ?? CODE_VERIFIER,
    clientId: overrides.clientId ?? CLIENT_ID,
    redirectUri: overrides.redirectUri ?? REDIRECT_URI,
  });
}

describe('verifyCodeChallenge', () => {
  it('accepts a valid S256 verifier/challenge pair', () => {
    expect(verifyCodeChallenge(CODE_VERIFIER, CODE_CHALLENGE)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    expect(verifyCodeChallenge('wrong-verifier', CODE_CHALLENGE)).toBe(false);
  });

  it('produces base64url challenges without padding', () => {
    const challenge = base64urlSha256(CODE_VERIFIER);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(verifyCodeChallenge(CODE_VERIFIER, challenge)).toBe(true);
  });
});

describe('McpAuthService.createAuthorizationCode', () => {
  it('returns the raw code and stores only its SHA-256 hash', async () => {
    const { service, codes } = createHarness();

    const raw = await service.createAuthorizationCode({
      clientId: CLIENT_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      redirectUri: REDIRECT_URI,
      scope: SCOPE,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
    });

    expect(raw).toHaveLength(32);
    expect(codes).toHaveLength(1);
    const stored = codes[0];
    expect(stored.codeHash).toBe(sha256(raw));
    expect(stored.codeHash).not.toBe(raw);
    expect(stored.clientId).toBe(CLIENT_ID);
    expect(stored.authUserId).toBe(USER_ID);
    expect(stored.tenantId).toBe(TENANT_ID);
    expect(stored.redirectUri).toBe(REDIRECT_URI);
    expect(stored.scope).toBe(SCOPE);
    expect(stored.codeChallenge).toBe(CODE_CHALLENGE);
    expect(stored.codeChallengeMethod).toBe('S256');
    expect(stored.consumedAt).toBeNull();
  });

  it('sets a 5-minute expiry', async () => {
    const { service, codes } = createHarness();
    const before = Date.now();

    await service.createAuthorizationCode({
      clientId: CLIENT_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      redirectUri: REDIRECT_URI,
      scope: SCOPE,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
    });

    const expiresAt = codes[0].expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
  });

  it('issues a different code on every call', async () => {
    const { service } = createHarness();
    const params = {
      clientId: CLIENT_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      redirectUri: REDIRECT_URI,
      scope: SCOPE,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256' as const,
    };
    const first = await service.createAuthorizationCode(params);
    const second = await service.createAuthorizationCode(params);
    expect(first).not.toBe(second);
  });
});

describe('McpAuthService.exchangeCode', () => {
  it('accepts a dynamically registered client and keeps its id on session and connection', async () => {
    const harness = createHarness();
    const dynamicId = 'corvo-mcp-AbCdEfGh12345678';
    const { raw } = seedCode(harness.codes, { clientId: dynamicId });

    await harness.service.exchangeCode({
      code: raw,
      codeVerifier: CODE_VERIFIER,
      clientId: dynamicId,
      redirectUri: REDIRECT_URI,
    });

    expect(harness.sessions[0].clientId).toBe(dynamicId);
    expect(harness.connections[0].clientId).toBe(dynamicId);
  });

  it('carries the environment chosen on consent to the connection and the validated token', async () => {
    const harness = createHarness();
    const live = seedCode(harness.codes, { environment: 'live' });
    const tokens = await exchange(harness, live.raw);

    expect(harness.connections[0].environment).toBe('live');
    expect(harness.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        notice: { kind: 'mcp-connected', clientName: 'Claude' },
      }),
    );
    const payload = await harness.service.validateAccessToken(
      tokens.accessToken,
    );
    expect(payload.environment).toBe('live');
  });

  it('defaults to test and lets a reconnect switch the environment', async () => {
    const harness = createHarness();
    const first = seedCode(harness.codes);
    await exchange(harness, first.raw);
    expect(harness.connections[0].environment).toBe('test');
    expect(harness.eventBus.publishBestEffort).not.toHaveBeenCalled();

    seedCode(harness.codes, {
      codeHash: sha256('switch-code'),
      environment: 'live',
    });
    await harness.service.exchangeCode({
      code: 'switch-code',
      codeVerifier: CODE_VERIFIER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });
    expect(harness.connections).toHaveLength(1);
    expect(harness.connections[0].environment).toBe('live');
  });

  it('rejects a client id that is not an MCP client', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes, { clientId: 'corvo-web' });

    await expect(
      harness.service.exchangeCode({
        code: raw,
        codeVerifier: CODE_VERIFIER,
        clientId: 'corvo-web',
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toThrow();
  });

  it('reconnecting the same client reuses the connection and revokes the old session', async () => {
    const harness = createHarness();
    const first = seedCode(harness.codes);
    await exchange(harness, first.raw);
    harness.connections[0].toolCallsCount = 7;

    const second = seedCode(harness.codes, { codeHash: sha256('second-code') });
    await harness.service.exchangeCode({
      code: 'second-code',
      codeVerifier: CODE_VERIFIER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });
    void second;

    expect(harness.connections).toHaveLength(1);
    expect(harness.connections[0].toolCallsCount).toBe(7);
    expect(harness.sessions).toHaveLength(2);
    expect(harness.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(harness.connections[0].sessionId).toBe(harness.sessions[1].id);
  });

  it('exchanges a valid code for tokens and provisions session + connection', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);

    const tokens = await exchange(harness, raw);

    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresIn).toBe(900);
    expect(tokens.scope).toBe(SCOPE);
    expect(tokens.refreshToken).toHaveLength(48);
    expect(typeof tokens.accessToken).toBe('string');

    // Code is consumed.
    expect(harness.codes[0].consumedAt).toBeInstanceOf(Date);

    // Session row: oauth_refresh kind with hashed refresh token.
    expect(harness.sessions).toHaveLength(1);
    const session = harness.sessions[0];
    expect(session.kind).toBe('oauth_refresh');
    expect(session.clientId).toBe(CLIENT_ID);
    expect(session.authUserId).toBe(USER_ID);
    expect(session.activeTenantId).toBe(TENANT_ID);
    expect(session.refreshTokenHash).toBe(sha256(tokens.refreshToken));
    expect(session.sessionTokenHash).toBeNull();
    expect(session.revokedAt).toBeNull();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Connection row with split scopes.
    expect(harness.connections).toHaveLength(1);
    const connection = harness.connections[0];
    expect(connection.authUserId).toBe(USER_ID);
    expect(connection.tenantId).toBe(TENANT_ID);
    expect(connection.clientId).toBe(CLIENT_ID);
    expect(connection.sessionId).toBe(session.id);
    expect(connection.scopes).toEqual(['nfse:read', 'nfse:write']);

    // Access token validates and maps to the expected payload.
    const payload = await harness.service.validateAccessToken(
      tokens.accessToken,
    );
    expect(payload.sub).toBe(USER_ID);
    expect(payload.tenant_id).toBe(TENANT_ID);
    expect(payload.scopes).toEqual(['nfse:read', 'nfse:write']);
    expect(payload.connection_id).toBe(connection.id);
    expect(payload.aud).toBe('corvo-mcp');
  });

  it('rejects a wrong PKCE verifier without consuming the code', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);

    await expect(
      exchange(harness, raw, { codeVerifier: 'totally-wrong-verifier' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(harness.codes[0].consumedAt).toBeNull();
    expect(harness.sessions).toHaveLength(0);
    expect(harness.connections).toHaveLength(0);
  });

  it('rejects an expired code', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(exchange(harness, raw)).rejects.toThrow(UnauthorizedException);
    expect(harness.sessions).toHaveLength(0);
  });

  it('rejects an already-consumed code', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes, { consumedAt: new Date() });

    await expect(exchange(harness, raw)).rejects.toThrow(UnauthorizedException);
    expect(harness.sessions).toHaveLength(0);
  });

  it('rejects an unknown code', async () => {
    const harness = createHarness();

    await expect(exchange(harness, 'nonexistent-code')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a redirect_uri mismatch', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);

    await expect(
      exchange(harness, raw, { redirectUri: 'http://evil.test/callback' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.sessions).toHaveLength(0);
  });

  it('rejects a client_id other than corvo-mcp', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);

    await expect(
      exchange(harness, raw, { clientId: 'other-client' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.sessions).toHaveLength(0);
  });
});

describe('McpAuthService.exchangeCode audit', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records agent.connected as the person who authorized, with the client name and scopes', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes, {
      scope: 'nfse:read nfse:write nfse:certificates',
      environment: 'live',
    });
    await exchange(harness, raw);
    expect(harness.audit.events).toHaveLength(1);
    expect(harness.audit.events[0]).toMatchObject({
      tenantId: TENANT_ID,
      environment: 'live',
      action: 'agent.connected',
      actor: { type: 'user', id: USER_ID },
      target: {
        type: 'agent_connection',
        id: harness.connections[0].id,
        label: 'Claude',
      },
      metadata: { scopes: 'nfse:read nfse:write nfse:certificates' },
    });
  });

  it('never stores tokens or the refresh token', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);
    const tokens = await exchange(harness, raw);
    const dump = JSON.stringify(harness.audit.events);
    expect(dump).not.toContain(tokens.accessToken);
    expect(dump).not.toContain(tokens.refreshToken);
    expect(dump).not.toContain(raw);
  });

  it('records nothing when the code is rejected', async () => {
    const harness = createHarness();
    await expect(exchange(harness, 'unknown-code')).rejects.toThrow();
    expect(harness.audit.events).toHaveLength(0);
  });

  it('keeps the connection when the recorder fails', async () => {
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const harness = createHarness(failingAccountAudit());
    const { raw } = seedCode(harness.codes);
    await expect(exchange(harness, raw)).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
    expect(harness.connections).toHaveLength(1);
  });
});

describe('McpAuthService.refreshTokens', () => {
  async function issueTokens(harness: ReturnType<typeof createHarness>) {
    const { raw } = seedCode(harness.codes);
    return exchange(harness, raw);
  }

  it('rotates the refresh token and issues a new access token', async () => {
    const harness = createHarness();
    const first = await issueTokens(harness);
    const connectionId = harness.connections[0].id;

    const second = await harness.service.refreshTokens(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.refreshToken).toHaveLength(48);
    expect(second.tokenType).toBe('Bearer');
    expect(second.expiresIn).toBe(900);
    expect(second.scope).toBe(SCOPE);

    // Stored hash updated to the rotated token.
    expect(harness.sessions[0].refreshTokenHash).toBe(
      sha256(second.refreshToken),
    );

    // New access token is valid and bound to the same connection.
    const payload = await harness.service.validateAccessToken(
      second.accessToken,
    );
    expect(payload.sub).toBe(USER_ID);
    expect(payload.tenant_id).toBe(TENANT_ID);
    expect(payload.connection_id).toBe(connectionId);
    expect(payload.scopes).toEqual(['nfse:read', 'nfse:write']);

    // Old refresh token no longer works.
    await expect(
      harness.service.refreshTokens(first.refreshToken),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('grants 90 days at connect and slides the expiry on each refresh', async () => {
    const harness = createHarness();
    const day = 24 * 60 * 60 * 1000;
    const first = await issueTokens(harness);
    expect(
      harness.sessions[0].expiresAt.getTime() - Date.now(),
    ).toBeLessThanOrEqual(90 * day);
    // 80 days later the grant is about to lapse; a refresh pushes it out again.
    harness.sessions[0].expiresAt = new Date(Date.now() + 10 * day);

    await harness.service.refreshTokens(first.refreshToken);

    expect(
      harness.sessions[0].expiresAt.getTime() - Date.now(),
    ).toBeGreaterThan(89 * day);
  });

  it('does not touch connection last_used_at on refresh', async () => {
    const harness = createHarness();
    const first = await issueTokens(harness);
    harness.connections[0].lastUsedAt = null;

    await harness.service.refreshTokens(first.refreshToken);

    expect(harness.connections[0].lastUsedAt).toBeNull();
  });

  it('rejects an unknown refresh token', async () => {
    const harness = createHarness();

    await expect(
      harness.service.refreshTokens('unknown-token'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a revoked session', async () => {
    const harness = createHarness();
    const first = await issueTokens(harness);
    const sessionId = harness.sessions[0].id;

    await harness.service.revokeSession(sessionId, TENANT_ID, USER_ID);

    await expect(
      harness.service.refreshTokens(first.refreshToken),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('McpAuthService.validateAccessToken', () => {
  it('throws on a malformed token', async () => {
    const harness = createHarness();

    await expect(
      harness.service.validateAccessToken('not-a-jwt'),
    ).rejects.toThrow();
  });

  it('throws on an expired token', async () => {
    const harness = createHarness();
    const secret = new TextEncoder().encode('a'.repeat(32));
    const expired = await new SignJWT({
      sub: USER_ID,
      tenant_id: TENANT_ID,
      scopes: ['nfse:read'],
      connection_id: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .setAudience('corvo-mcp')
      .sign(secret);

    await expect(
      harness.service.validateAccessToken(expired),
    ).rejects.toThrow();
  });

  it('throws on a token signed with a different secret', async () => {
    const harness = createHarness();
    const otherSecret = new TextEncoder().encode('z'.repeat(32));
    const forged = await new SignJWT({
      sub: USER_ID,
      tenant_id: TENANT_ID,
      scopes: ['nfse:read'],
      connection_id: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setAudience('corvo-mcp')
      .sign(otherSecret);

    await expect(harness.service.validateAccessToken(forged)).rejects.toThrow();
  });
});

describe('McpAuthService.revokeSession', () => {
  it('marks the session as revoked', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);
    await exchange(harness, raw);
    const sessionId = harness.sessions[0].id;

    await harness.service.revokeSession(sessionId, TENANT_ID, USER_ID);

    expect(harness.sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('is idempotent for unknown sessions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.revokeSession(randomUUID(), TENANT_ID, USER_ID),
    ).resolves.toBeUndefined();
  });
});

describe('MCP tenant boundaries and immediate revocation', () => {
  async function issue(harness: ReturnType<typeof createHarness>) {
    const { raw } = seedCode(harness.codes);
    return exchange(harness, raw);
  }
  it('consumes each authorization code once under concurrent exchanges', async () => {
    const harness = createHarness();
    const { raw } = seedCode(harness.codes);
    const results = await Promise.allSettled([
      exchange(harness, raw),
      exchange(harness, raw),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(harness.sessions).toHaveLength(1);
    expect(harness.connections).toHaveLength(1);
  });
  it('rotates each refresh token once under concurrent requests', async () => {
    const harness = createHarness();
    const tokens = await issue(harness);
    const results = await Promise.allSettled([
      harness.service.refreshTokens(tokens.refreshToken),
      harness.service.refreshTokens(tokens.refreshToken),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
  });
  it('rejects an access token immediately after session revocation', async () => {
    const harness = createHarness();
    const tokens = await issue(harness);
    await harness.service.revokeSession(
      harness.sessions[0].id,
      TENANT_ID,
      USER_ID,
    );
    await expect(
      harness.service.validateAccessToken(tokens.accessToken),
    ).rejects.toThrow(UnauthorizedException);
  });
  it('rejects a connection belonging to a different tenant or account', async () => {
    const harness = createHarness();
    const tokens = await issue(harness);
    harness.connections[0].tenantId = randomUUID();
    await expect(
      harness.service.validateAccessToken(tokens.accessToken),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      harness.service.refreshTokens(tokens.refreshToken),
    ).rejects.toThrow(UnauthorizedException);
    harness.connections[0].tenantId = TENANT_ID;
    harness.connections[0].authUserId = randomUUID();
    await expect(
      harness.service.validateAccessToken(tokens.accessToken),
    ).rejects.toThrow(UnauthorizedException);
  });
  it('rejects access and refresh after the membership becomes inactive', async () => {
    const harness = createHarness();
    const tokens = await issue(harness);
    harness.memberships.findByAuthUserAndTenant.mockResolvedValue({
      isActive: false,
    });
    await expect(
      harness.service.validateAccessToken(tokens.accessToken),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      harness.service.refreshTokens(tokens.refreshToken),
    ).rejects.toThrow(UnauthorizedException);
  });
  it('cannot revoke a session using a foreign tenant', async () => {
    const harness = createHarness();
    await issue(harness);
    await harness.service.revokeSession(
      harness.sessions[0].id,
      randomUUID(),
      USER_ID,
    );
    expect(harness.sessions[0].revokedAt).toBeNull();
  });
});
