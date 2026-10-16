import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthUserService } from './auth-user.service';
import { AuthIdentityService } from './auth-identity.service';
import { CookieSessionService } from './cookie-session.service';
import { AuthContextService } from './auth-context.service';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '@/infra/config/configuration.types';
import { OtpFlowService } from '@/modules/security/otp/application/otp-flow.service';
import { OtpChallengeService } from '@/modules/security/otp/application/otp-challenge.service';
import { normalizeEmail } from './auth-user.service';
import { EmailService } from '@/modules/email/application/email.service';
import { PasswordlessWorkspaceService } from './passwordless-workspace.service';
import type { AuthUser } from '../domain/auth-user';

export interface MagicLinkRequestResult {
  challengeId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

export interface MagicLinkVerifyResult {
  sessionToken: string;
  expiresAt: Date;
  csrfToken: string;
  isNewUser: boolean;
}

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly otp: OtpFlowService,
    private readonly challenges: OtpChallengeService,
    private readonly authUserService: AuthUserService,
    private readonly authIdentityService: AuthIdentityService,
    private readonly sessionService: CookieSessionService,
    private readonly authContextService: AuthContextService,
    private readonly config: ConfigService,
    private readonly workspaces: PasswordlessWorkspaceService,
    private readonly emailService: EmailService,
  ) {}

  private readonly logger = new Logger(MagicLinkService.name);

  async requestCode(
    email: string,
    requestIp?: string,
  ): Promise<MagicLinkRequestResult> {
    const issued = await this.otp.request({
      ...this.scope(email),
      requestIp,
    });
    return {
      challengeId: issued.challengeId,
      expiresAt: new Date(issued.expiresAt),
      resendAvailableAt: new Date(issued.resendAvailableAt),
    };
  }

  async verifyCode(
    email: string,
    code: string,
    challengeId: string,
  ): Promise<MagicLinkVerifyResult> {
    const verification = await this.challenges.verify({
      ...this.scope(email),
      challengeId,
      code,
    });
    if (!verification.valid) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'OTP_INVALID_OR_EXPIRED',
        message: 'Invalid or expired verification code',
      });
    }

    email = normalizeEmail(email);

    // Find or create user
    const { user, isNew } =
      await this.authIdentityService.findOrCreateUserByMagicLink(email);

    return this.completeLogin(user, isNew, 'magic-link');
  }

  /**
   * Finishes a sign-in whose email was already proven (code or OAuth provider):
   * marks it verified, makes sure the user has a workspace, welcomes new users
   * and opens the session.
   */
  async completeLogin(
    user: AuthUser,
    isNew: boolean,
    userAgent: string,
  ): Promise<MagicLinkVerifyResult> {
    await this.authUserService.markEmailVerified(user.id, new Date());

    await this.workspaces.ensureWorkspace(user);
    if (isNew) await this.sendWelcome(user.email, user.name);
    const context = await this.authContextService.buildForAuthUser(
      user.id,
      'corvo',
    );

    const authConfig = this.config.getOrThrow<AuthConfig>('auth');
    const sessionTtlMs = authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionTtlMs);

    const { sessionToken, session } = await this.sessionService.createSession({
      authUserId: user.id,
      activeTenantId: context.activeTenantId,
      userAgent,
      ipHash: null,
      expiresAt,
    });

    const csrfToken = this.sessionService.generateCsrfToken(session.id);

    return {
      sessionToken,
      expiresAt,
      csrfToken,
      isNewUser: isNew,
    };
  }

  private async sendWelcome(email: string, name: string): Promise<void> {
    try {
      await this.emailService.enqueueWelcome({ to: email, name });
    } catch (err) {
      // A failed welcome email must never block sign-in.
      this.logger.warn(
        `Welcome email not enqueued: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private scope(email: string) {
    const target = normalizeEmail(email);
    return {
      audience: 'public' as const,
      productKey: 'corvo',
      channel: 'email' as const,
      purpose: 'magic_link_login' as const,
      subjectId: this.otp.publicSubjectId('corvo', 'email', target),
      target,
    };
  }
}
