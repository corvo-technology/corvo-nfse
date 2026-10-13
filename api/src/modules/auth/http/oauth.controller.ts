import { RawResponse } from '@/shared/http/response.interceptor';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { OAuthProviderConfig } from '@/infra/config/configuration.types';
import { AuthIdentityService } from '../application/auth-identity.service';
import { CookieSessionService } from '../application/cookie-session.service';
import { AuthContextService } from '../application/auth-context.service';
import { AuthConfig } from '@/infra/config/configuration.types';
import { AuthIdentityProvider } from '../domain/auth-identity';
import { Logger } from '@nestjs/common';

@Controller('auth/oauth')
@ApiTags('Auth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identities: AuthIdentityService,
    private readonly sessions: CookieSessionService,
    private readonly contexts: AuthContextService,
  ) {}

  @Get('google/authorize')
  @ApiOperation({ summary: 'Redirect to Google OAuth' })
  googleAuthorize() {
    const google = this.config.get<OAuthProviderConfig>('google');
    if (!google?.clientId || !google.redirectUrl) {
      throw new Error('Google OAuth not configured');
    }
    const scope = 'openid email profile';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${google.clientId}&redirect_uri=${encodeURIComponent(google.redirectUrl)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline`;
    return { url };
  }

  @Get('github/authorize')
  @ApiOperation({ summary: 'Redirect to GitHub OAuth' })
  githubAuthorize() {
    const github = this.config.get<OAuthProviderConfig>('github');
    if (!github?.clientId || !github.redirectUrl) {
      throw new Error('GitHub OAuth not configured');
    }
    const scope = 'read:user user:email';
    const url = `https://github.com/login/oauth/authorize?client_id=${github.clientId}&redirect_uri=${encodeURIComponent(github.redirectUrl)}&scope=${encodeURIComponent(scope)}`;
    return { url };
  }

  @RawResponse()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Res({ passthrough: false }) res: Response,
  ) {
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
      id: string;
      email: string;
      name: string;
      picture?: string;
    };

    const result = await this.handleOAuthLogin({
      provider: 'google',
      providerUserId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture ?? null,
    });

    this.setSessionCookies(res, result);
    res.redirect('/dashboard?is_new=' + result.isNewUser);
  }

  @RawResponse()
  @Get('github/callback')
  @ApiOperation({ summary: 'GitHub OAuth callback' })
  async githubCallback(
    @Query('code') code: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const github = this.config.get<OAuthProviderConfig>('github');
    if (!github?.clientId || !github.clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }

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
      id: number;
      email?: string;
      name?: string;
      login: string;
      avatar_url?: string;
    };

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

    const result = await this.handleOAuthLogin({
      provider: 'github',
      providerUserId: String(githubUser.id),
      email,
      name: githubUser.name ?? githubUser.login,
      avatarUrl: githubUser.avatar_url ?? null,
    });

    this.setSessionCookies(res, result);
    res.redirect('/dashboard?is_new=' + result.isNewUser);
  }

  private async handleOAuthLogin(input: {
    provider: AuthIdentityProvider;
    providerUserId: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  }) {
    const { user, isNew } =
      await this.identities.findOrCreateUserByOAuth(input);

    const context = await this.contexts.buildForAuthUser(user.id, 'corvo');

    const authConfig = this.config.getOrThrow<AuthConfig>('auth');
    const sessionTtlMs = authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionTtlMs);

    const { sessionToken, session } = await this.sessions.createSession({
      authUserId: user.id,
      activeTenantId: context.activeTenantId,
      userAgent: `oauth-${input.provider}`,
      ipHash: null,
      expiresAt,
    });

    const csrfToken = this.sessions.generateCsrfToken(session.id);

    return { sessionToken, expiresAt, csrfToken, isNewUser: isNew };
  }

  private setSessionCookies(
    res: Response,
    result: { sessionToken: string; expiresAt: Date; csrfToken: string },
  ) {
    res.cookie('corvo_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
    });
    res.cookie('corvo_csrf', result.csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
    });
  }
}
