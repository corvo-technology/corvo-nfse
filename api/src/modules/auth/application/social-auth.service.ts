import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUserService } from './auth-user.service';
import { CookieSessionService } from './cookie-session.service';
import { AuthContextService } from './auth-context.service';
import { OAuthProviderConfig } from '@/infra/config/configuration.types';

export type SocialLoginResult = {
  sessionToken: string;
  expiresAt: Date;
  csrfToken: string;
  isNewUser: boolean;
};

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly authUserService: AuthUserService,
    private readonly sessionService: CookieSessionService,
    private readonly authContextService: AuthContextService,
  ) {}

  // ─── Google OAuth ──────────────────────────────────────────────

  getGoogleAuthUrl(): string {
    const google = this.config.get<OAuthProviderConfig>('google');
    if (!google?.clientId || !google.redirectUrl)
      throw new Error('Google OAuth not configured');
    const scope = 'openid email profile';
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${google.clientId}&redirect_uri=${encodeURIComponent(google.redirectUrl)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline`;
  }

  async handleGoogleCallback(code: string): Promise<SocialLoginResult> {
    const google = this.config.get<OAuthProviderConfig>('google');
    if (!google?.clientId || !google.clientSecret || !google.redirectUrl) {
      throw new Error('Google OAuth not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      this.logger.error(
        `Google token exchange failed: ${tokenRes.status} ${body}`,
      );
      throw new Error('Failed to authenticate with Google');
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    const userRes = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    if (!userRes.ok) {
      this.logger.error(`Google userinfo failed: ${userRes.status}`);
      throw new Error('Failed to fetch Google user info');
    }

    const googleUser = (await userRes.json()) as {
      email: string;
      name: string;
      picture?: string;
    };

    return this.handleSocialLogin(
      googleUser.email,
      googleUser.name,
      googleUser.picture,
    );
  }

  // ─── GitHub OAuth ──────────────────────────────────────────────

  getGitHubAuthUrl(): string {
    const github = this.config.get<OAuthProviderConfig>('github');
    if (!github?.clientId || !github.redirectUrl)
      throw new Error('GitHub OAuth not configured');
    const scope = 'read:user user:email';
    return `https://github.com/login/oauth/authorize?client_id=${github.clientId}&redirect_uri=${encodeURIComponent(github.redirectUrl)}&scope=${encodeURIComponent(scope)}`;
  }

  async handleGitHubCallback(code: string): Promise<SocialLoginResult> {
    const github = this.config.get<OAuthProviderConfig>('github');
    if (!github?.clientId || !github.clientSecret)
      throw new Error('GitHub OAuth not configured');

    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: github.clientId,
          client_secret: github.clientSecret,
          code,
        }),
      },
    );

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      this.logger.error(
        `GitHub token exchange failed: ${tokenRes.status} ${body}`,
      );
      throw new Error('Failed to authenticate with GitHub');
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      this.logger.error(`GitHub user info failed: ${userRes.status}`);
      throw new Error('Failed to fetch GitHub user info');
    }

    const githubUser = (await userRes.json()) as {
      email?: string;
      name?: string;
      login: string;
      avatar_url?: string;
    };

    // GitHub email might be private
    let email = githubUser.email;
    if (!email) {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as {
          email: string;
          primary: boolean;
        }[];
        email = emails.find((e) => e.primary)?.email ?? emails[0]?.email;
      }
    }

    if (!email) {
      throw new Error('Could not retrieve email from GitHub');
    }

    return this.handleSocialLogin(
      email,
      githubUser.name ?? githubUser.login,
      githubUser.avatar_url,
    );
  }

  // ─── Shared logic ──────────────────────────────────────────────

  private async handleSocialLogin(
    email: string,
    name: string,
    _avatarUrl?: string,
  ): Promise<SocialLoginResult> {
    let isNewUser = false;
    let user = await this.authUserService.findByEmail(email);

    if (!user) {
      isNewUser = true;
      user = await this.authUserService.createUser({
        email,
        name,
      });

      // TODO: create tenant + membership via AuthIdentityService when implemented
    }

    // Build auth context
    const context = await this.authContextService.buildForAuthUser(
      user.id,
      'corvo',
    );

    // Create session
    const authConfig = this.config.getOrThrow<{ refreshTokenTtlDays: number }>(
      'auth',
    );
    const sessionTtlMs = authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionTtlMs);

    const { sessionToken, session } = await this.sessionService.createSession({
      authUserId: user.id,
      activeTenantId: context.activeTenantId,
      userAgent: 'social-login',
      ipHash: null,
      expiresAt,
    });

    const csrfToken = this.sessionService.generateCsrfToken(session.id);

    return {
      sessionToken,
      expiresAt,
      csrfToken,
      isNewUser,
    };
  }
}
