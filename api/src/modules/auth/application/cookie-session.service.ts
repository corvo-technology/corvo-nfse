import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { IAuthSessionRepository } from '../domain/auth-session.repository';
import { AuthSession } from '../domain/auth-session';
import { CsrfService } from './csrf.service';

@Injectable()
export class CookieSessionService {
  constructor(
    @Inject(IAuthSessionRepository)
    private readonly sessions: IAuthSessionRepository,
    private readonly csrfService: CsrfService,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createSession(input: {
    authUserId: string;
    activeTenantId: string | null;
    userAgent: string | null;
    ipHash: string | null;
    expiresAt: Date;
  }): Promise<{ sessionToken: string; session: AuthSession }> {
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionTokenHash = CookieSessionService.hashToken(sessionToken);

    // Revoke ALL existing sessions for this user (one active session per user)
    await this.sessions.revokeAllForUser(
      input.authUserId,
      'new_session_created',
    );

    const now = new Date();
    const session = await this.sessions.save({
      id: crypto.randomUUID(),
      authUserId: input.authUserId,
      clientId: 'corvo-web',
      refreshTokenHash: null,
      kind: 'web',
      sessionTokenHash,
      activeTenantId: input.activeTenantId,
      revokedAt: null,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return { sessionToken, session };
  }

  async validateSession(sessionToken: string): Promise<AuthSession | null> {
    const hash = CookieSessionService.hashToken(sessionToken);
    return this.sessions.findActiveBySessionTokenHash(hash);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) return;
    session.revokedAt = new Date();
    await this.sessions.update(session);
  }

  async revokeAllForUser(authUserId: string, reason: string): Promise<number> {
    return this.sessions.revokeAllForUser(authUserId, reason);
  }

  generateCsrfToken(sessionId: string): string {
    return this.csrfService.generateToken(sessionId);
  }

  async switchTenant(
    session: AuthSession,
    tenantId: string,
  ): Promise<AuthSession> {
    session.activeTenantId = tenantId;
    return this.sessions.update(session);
  }
}
