import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { ITenantMembershipRepository } from '@/modules/auth/domain/tenant-membership.repository';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import * as jose from 'jose';
import { nanoid } from 'nanoid';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { AuthConfig } from '@/infra/config/configuration.types';
import {
  AuthAuthorizationCodeOrmEntity,
  AuthSessionOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { McpConnectionOrmEntity } from './infra/mcp-connection.orm-entity';

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  scope: string;
}

export interface McpTokenPayload {
  sub: string;
  tenant_id: string;
  scopes: string[];
  connection_id: string;
  aud?: string;
  session_id?: string;
}

export const MCP_TOKEN_AUDIENCE = 'corvo-mcp';
export const MCP_CLIENT_ID = 'corvo-mcp';
const ACCESS_TOKEN_TTL_SECONDS = 900;
const ACCESS_TOKEN_TTL = '15m';
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const REFRESH_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const CODE_SIZE = 32;
const REFRESH_TOKEN_SIZE = 48;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * PKCE S256 verification: BASE64URL(SHA256(code_verifier)) === code_challenge
 */
export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const computed = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return computed === codeChallenge;
}

@Injectable()
export class McpAuthService {
  constructor(
    @InjectRepository(AuthAuthorizationCodeOrmEntity)
    private readonly codesRepo: Repository<AuthAuthorizationCodeOrmEntity>,
    @InjectRepository(AuthSessionOrmEntity)
    private readonly sessionsRepo: Repository<AuthSessionOrmEntity>,
    @InjectRepository(McpConnectionOrmEntity)
    private readonly connectionsRepo: Repository<McpConnectionOrmEntity>,
    private readonly config: ConfigService,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
  ) {}

  async createAuthorizationCode(params: {
    clientId: string;
    userId: string;
    tenantId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
  }): Promise<string> {
    return runAsSystem('oauth-bootstrap', async () => {
      await this.requireMembership(params.userId, params.tenantId);
      const rawCode = nanoid(CODE_SIZE);

      await this.codesRepo.insert({
        id: randomUUID(),
        clientId: params.clientId,
        authUserId: params.userId,
        productKey: 'corvo',
        codeHash: sha256(rawCode),
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        redirectUri: params.redirectUri,
        scope: params.scope,
        tenantId: params.tenantId,
        expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
        consumedAt: null,
      });

      return rawCode;
    });
  }

  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<TokenResponse> {
    return runAsSystem('oauth-bootstrap', async () => {
      const code = await this.codesRepo.findOne({
        where: { codeHash: sha256(params.code) },
      });

      if (!code || code.consumedAt || code.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException(
          'Invalid or expired authorization code',
        );
      }
      if (
        code.clientId !== params.clientId ||
        code.clientId !== MCP_CLIENT_ID
      ) {
        throw new UnauthorizedException('Invalid OAuth client');
      }
      if (code.redirectUri !== params.redirectUri) {
        throw new UnauthorizedException('redirect_uri mismatch');
      }
      if (!verifyCodeChallenge(params.codeVerifier, code.codeChallenge)) {
        throw new UnauthorizedException('PKCE verification failed');
      }
      if (!code.tenantId) {
        throw new UnauthorizedException('Authorization code has no tenant');
      }

      await this.requireMembership(code.authUserId, code.tenantId);
      const consumed = await this.codesRepo.update(
        {
          id: code.id,
          authUserId: code.authUserId,
          tenantId: code.tenantId,
          consumedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        { consumedAt: new Date() },
      );
      if (consumed.affected !== 1)
        throw new UnauthorizedException(
          'Invalid or expired authorization code',
        );

      const rawRefreshToken = nanoid(REFRESH_TOKEN_SIZE);
      const session = this.sessionsRepo.create({
        id: randomUUID(),
        authUserId: code.authUserId,
        clientId: MCP_CLIENT_ID,
        kind: 'oauth_refresh',
        refreshTokenHash: sha256(rawRefreshToken),
        sessionTokenHash: null,
        activeTenantId: code.tenantId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_MS),
      } as AuthSessionOrmEntity);
      await this.sessionsRepo.insert(session);

      const scopes = code.scope.split(' ').filter((s) => s.length > 0);
      const connection = this.connectionsRepo.create({
        id: randomUUID(),
        authUserId: code.authUserId,
        tenantId: code.tenantId,
        clientId: code.clientId,
        sessionId: session.id,
        scopes,
        revokedAt: null,
        lastUsedAt: null,
      } as McpConnectionOrmEntity);
      await this.connectionsRepo.insert(connection);

      const accessToken = await this.signAccessToken({
        sub: code.authUserId,
        tenant_id: code.tenantId,
        scopes,
        connection_id: connection.id,
      });

      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: rawRefreshToken,
        scope: code.scope,
      };
    });
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    return runAsSystem('oauth-bootstrap', async () => {
      const session = await this.sessionsRepo.findOne({
        where: { refreshTokenHash: sha256(refreshToken) },
      });

      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        session.kind !== 'oauth_refresh' ||
        session.clientId !== MCP_CLIENT_ID ||
        !session.activeTenantId
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const connection = await this.connectionsRepo.findOne({
        where: {
          sessionId: session.id,
          tenantId: session.activeTenantId,
          authUserId: session.authUserId,
          clientId: MCP_CLIENT_ID,
        },
      });
      if (!connection || connection.revokedAt) {
        throw new UnauthorizedException('No active MCP connection for session');
      }

      await this.requireMembership(session.authUserId, session.activeTenantId);
      const rawRefreshToken = nanoid(REFRESH_TOKEN_SIZE);
      const rotated = await this.sessionsRepo.update(
        {
          id: session.id,
          activeTenantId: session.activeTenantId,
          authUserId: session.authUserId,
          revokedAt: IsNull(),
          refreshTokenHash: sha256(refreshToken),
        },
        { refreshTokenHash: sha256(rawRefreshToken) },
      );
      if (rotated.affected !== 1)
        throw new UnauthorizedException('Invalid refresh token');

      const accessToken = await this.signAccessToken({
        sub: session.authUserId,
        tenant_id: connection.tenantId,
        scopes: connection.scopes,
        connection_id: connection.id,
      });

      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: rawRefreshToken,
        scope: connection.scopes.join(' '),
      };
    });
  }

  async validateAccessToken(token: string): Promise<McpTokenPayload> {
    let payload: jose.JWTPayload;
    try {
      ({ payload } = await jose.jwtVerify(token, this.jwtSecret(), {
        audience: MCP_TOKEN_AUDIENCE,
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tenantId =
      typeof payload.tenant_id === 'string' ? payload.tenant_id : '';
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const connectionId =
      typeof payload.connection_id === 'string' ? payload.connection_id : '';
    try {
      requireTenantId(tenantId);
      requireTenantId(userId);
      requireTenantId(connectionId);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    return runWithTenant(tenantId, async () => {
      const connection = await this.connectionsRepo.findOne({
        where: {
          id: connectionId,
          tenantId,
          authUserId: userId,
          clientId: MCP_CLIENT_ID,
          revokedAt: IsNull(),
        },
      });
      if (!connection)
        throw new UnauthorizedException('Invalid or revoked connection');
      const session = await this.sessionsRepo.findOne({
        where: {
          id: connection.sessionId,
          activeTenantId: tenantId,
          authUserId: userId,
          clientId: MCP_CLIENT_ID,
          kind: 'oauth_refresh',
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      if (!session)
        throw new UnauthorizedException('Invalid or revoked session');
      await this.requireMembership(userId, tenantId);
      return {
        sub: userId,
        tenant_id: tenantId,
        scopes: connection.scopes,
        connection_id: connection.id,
        session_id: session.id,
        aud: MCP_TOKEN_AUDIENCE,
      };
    });
  }

  async revokeSession(
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    requireTenantId(tenantId);
    await this.sessionsRepo.update(
      {
        id: sessionId,
        activeTenantId: tenantId,
        authUserId: userId,
        kind: 'oauth_refresh',
        clientId: MCP_CLIENT_ID,
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
  }

  private async requireMembership(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    requireTenantId(tenantId);
    const membership = await this.memberships.findByAuthUserAndTenant(
      userId,
      tenantId,
    );
    if (!membership?.isActive)
      throw new UnauthorizedException('Tenant access denied');
  }

  private async signAccessToken(
    payload: Omit<McpTokenPayload, 'aud'>,
  ): Promise<string> {
    return new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_TTL)
      .setAudience(MCP_TOKEN_AUDIENCE)
      .sign(this.jwtSecret());
  }

  private jwtSecret(): Uint8Array {
    const auth = this.config.getOrThrow<AuthConfig>('auth');
    return new TextEncoder().encode(auth.jwtSecret);
  }
}
