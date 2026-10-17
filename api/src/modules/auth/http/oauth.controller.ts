import { RawResponse } from '@/shared/http/response.interceptor';
import { data } from '@/shared/http/response';
import {
  Controller,
  Get,
  Header,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { OAuthProviderConfig } from '@/infra/config/configuration.types';
import { AuthIdentityService } from '../application/auth-identity.service';
import { CookiePolicyService } from '../application/cookie-policy.service';
import { extractCookie } from '../application/cookie-reader';
import { MagicLinkService } from '../application/magic-link.service';
import { PublicRoute } from '../application/public-route.decorator';
import {
  OAUTH_STATE_MAX_AGE_MS,
  createOAuthState,
  readOAuthState,
} from './oauth-flow';
import {
  OAuthProfileError,
  fetchGitHubProfile,
  fetchGoogleProfile,
  type OAuthClientConfig,
  type OAuthProfile,
} from './oauth-providers';

const PROVIDERS = ['google', 'github'] as const;
type Provider = (typeof PROVIDERS)[number];

/** Where the browser lands when sign-in fails; the login screen shows the message. */
const failureUrl = (code: string) => `/login?error=${code}`;

/**
 * Social sign-in. The provider sends the browser back to the dashboard's own
 * origin (through its API proxy), so the session cookie is set for that origin,
 * exactly like the email-code login.
 */
@Controller('auth/oauth')
@PublicRoute()
@ApiTags('Auth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identities: AuthIdentityService,
    private readonly magicLinks: MagicLinkService,
    private readonly cookies: CookiePolicyService,
  ) {}

  @Get('providers')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Which social sign-in providers are configured' })
  providers() {
    return data({
      google: this.clientFor('google') !== null,
      github: this.clientFor('github') !== null,
    });
  }

  @RawResponse()
  @Get(':provider/authorize')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start the social sign-in (redirects to the provider)',
  })
  authorize(
    @Param('provider') name: string,
    @Query('next') next: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): void {
    const provider = this.providerOrThrow(name);
    res.setHeader('Cache-Control', 'no-store');
    const client = this.clientFor(provider);
    if (!client) {
      res.redirect(302, failureUrl('oauth_unavailable'));
      return;
    }
    const { state, cookieValue } = createOAuthState(next);
    this.cookies.set(
      res,
      'oauth_state',
      cookieValue,
      undefined,
      OAUTH_STATE_MAX_AGE_MS,
    );
    res.redirect(302, this.providerUrl(provider, client, state));
  }

  @RawResponse()
  @Get(':provider/callback')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Social sign-in callback' })
  async callback(
    @Param('provider') name: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const provider = this.providerOrThrow(name);
    res.setHeader('Cache-Control', 'no-store');
    const stateCookie = extractCookie(req, this.cookies.name('oauth_state'));
    // The state is single use, whatever the outcome.
    this.cookies.clear(res, 'oauth_state');

    if (providerError) {
      res.redirect(
        302,
        failureUrl(
          providerError === 'access_denied' ? 'oauth_denied' : 'oauth_failed',
        ),
      );
      return;
    }
    const resume = readOAuthState(stateCookie, state);
    const client = this.clientFor(provider);
    if (!resume || !code || !client) {
      res.redirect(
        302,
        failureUrl(client ? 'oauth_failed' : 'oauth_unavailable'),
      );
      return;
    }

    let profile: OAuthProfile;
    try {
      profile =
        provider === 'google'
          ? await fetchGoogleProfile(client, code)
          : await fetchGitHubProfile(client, code);
    } catch (error) {
      this.logger.warn(
        `${provider} sign-in rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      const unverified =
        error instanceof OAuthProfileError &&
        error.reason === 'email_unverified';
      res.redirect(
        302,
        failureUrl(unverified ? 'oauth_email_unverified' : 'oauth_failed'),
      );
      return;
    }

    try {
      const { user, isNew } = await this.identities.findOrCreateUserByOAuth({
        provider,
        ...profile,
      });
      const session = await this.magicLinks.completeLogin(
        user,
        isNew,
        `oauth-${provider}`,
      );
      this.cookies.set(res, 'session', session.sessionToken, session.expiresAt);
      res.redirect(302, resume.next);
    } catch (error) {
      this.logger.error(
        `${provider} sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.redirect(302, failureUrl('oauth_failed'));
    }
  }

  private providerOrThrow(name: string): Provider {
    if (!(PROVIDERS as readonly string[]).includes(name))
      throw new NotFoundException();
    return name as Provider;
  }

  private clientFor(provider: Provider): OAuthClientConfig | null {
    const cfg = this.config.get<OAuthProviderConfig>(provider);
    if (!cfg?.clientId || !cfg.clientSecret || !cfg.redirectUrl) return null;
    return {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
    };
  }

  private providerUrl(
    provider: Provider,
    client: OAuthClientConfig,
    state: string,
  ): string {
    const query = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: client.redirectUrl,
      state,
    });
    if (provider === 'google') {
      query.set('response_type', 'code');
      query.set('scope', 'openid email profile');
      // Always show the account chooser, so a shared browser does not sign in silently.
      query.set('prompt', 'select_account');
      return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    }
    query.set('scope', 'read:user user:email');
    return `https://github.com/login/oauth/authorize?${query.toString()}`;
  }
}
