import { AuthSession } from './auth-session';

export abstract class IAuthSessionRepository {
  abstract rotateRefreshToken(
    id: string,
    tenantId: string,
    authUserId: string,
    clientId: string,
    previousHash: string,
    nextHash: string,
    now?: Date,
  ): Promise<boolean>;
  abstract revokeOAuthSession(
    id: string,
    tenantId: string,
    authUserId: string,
    clientId: string,
  ): Promise<void>;
  abstract revokeTenantSession(
    id: string,
    tenantId: string,
    authUserId: string,
  ): Promise<void>;
  abstract findById(id: string): Promise<AuthSession | null>;
  abstract findActiveById(id: string, now?: Date): Promise<AuthSession | null>;
  abstract findActiveByRefreshTokenHash(
    refreshTokenHash: string,
    now?: Date,
  ): Promise<AuthSession | null>;
  abstract findActiveBySessionTokenHash(
    hash: string,
    now?: Date,
  ): Promise<AuthSession | null>;
  abstract revokeAllForUser(
    authUserId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number>;
  abstract save(session: AuthSession): Promise<AuthSession>;
  abstract update(session: AuthSession): Promise<AuthSession>;
}
