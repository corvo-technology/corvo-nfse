import type { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthIdentityService } from '../application/auth-identity.service';
import type { CookiePolicyService } from '../application/cookie-policy.service';
import type { MagicLinkService } from '../application/magic-link.service';
import { OAuthController } from './oauth.controller';
import { createOAuthState } from './oauth-flow';

const GOOGLE = {
  clientId: 'gid',
  clientSecret: 'gsecret',
  redirectUrl: 'https://corvo.tech/api/proxy/v1/auth/oauth/google/callback',
};
const GITHUB = {
  clientId: 'hid',
  clientSecret: 'hsecret',
  redirectUrl: 'https://corvo.tech/api/proxy/v1/auth/oauth/github/callback',
};

function build(
  settings: Record<string, unknown> = { google: GOOGLE, github: GITHUB },
) {
  const cookies = {
    name: (kind: string) => `gf_${kind}_dev`,
    set: jest.fn(),
    clear: jest.fn(),
  };
  const identities = {
    findOrCreateUserByOAuth: jest
      .fn()
      .mockResolvedValue({ user: { id: 'u1' }, isNew: false }),
  };
  const magicLinks = {
    completeLogin: jest.fn().mockResolvedValue({
      sessionToken: 'session-token',
      expiresAt: new Date('2026-11-01T00:00:00Z'),
      csrfToken: 'csrf',
      isNewUser: false,
    }),
  };
  const controller = new OAuthController(
    { get: (key: string) => settings[key] } as unknown as ConfigService,
    identities as unknown as AuthIdentityService,
    magicLinks as unknown as MagicLinkService,
    cookies as unknown as CookiePolicyService,
  );
  const res = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response & {
    redirect: jest.Mock;
  };
  const reqWith = (cookie?: string) =>
    ({
      headers: cookie
        ? { cookie: `gf_oauth_state_dev=${encodeURIComponent(cookie)}` }
        : {},
    }) as unknown as Request;
  return { controller, cookies, identities, magicLinks, res, reqWith };
}

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const mockGoogle = (profile: Record<string, unknown>) =>
  jest
    .spyOn(global, 'fetch')
    .mockImplementation((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            urlOf(input).includes('token') ? { access_token: 't' } : profile,
          ),
          { status: 200 },
        ),
      ),
    );

afterEach(() => jest.restoreAllMocks());

describe('OAuthController', () => {
  describe('providers', () => {
    it('reports which providers are configured', () => {
      expect(build().controller.providers().data).toEqual({
        google: true,
        github: true,
      });
      expect(build({ google: GOOGLE }).controller.providers().data).toEqual({
        google: true,
        github: false,
      });
      expect(build({}).controller.providers().data).toEqual({
        google: false,
        github: false,
      });
    });
  });

  describe('authorize', () => {
    it('stores a single-use state cookie and redirects to the provider with the same state', () => {
      const { controller, cookies, res } = build();
      controller.authorize('google', '/mcp/authorize?client_id=x', res);
      const [, kind, value, , maxAge] = cookies.set.mock.calls[0] as [
        unknown,
        string,
        string,
        unknown,
        number,
      ];
      expect(kind).toBe('oauth_state');
      expect(maxAge).toBe(10 * 60 * 1000);
      const location = new URL(
        (res.redirect.mock.calls as unknown[][])[0][1] as string,
      );
      expect(location.origin + location.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(location.searchParams.get('redirect_uri')).toBe(
        GOOGLE.redirectUrl,
      );
      expect(value.startsWith(`${location.searchParams.get('state')}.`)).toBe(
        true,
      );
    });

    it('sends GitHub users to GitHub with the email scope', () => {
      const { controller, res } = build();
      controller.authorize('github', undefined, res);
      const location = new URL(
        (res.redirect.mock.calls as unknown[][])[0][1] as string,
      );
      expect(location.origin).toBe('https://github.com');
      expect(location.searchParams.get('scope')).toBe('read:user user:email');
    });

    it('sends the user back to the login screen when the provider is not configured', () => {
      const { controller, res, cookies } = build({});
      controller.authorize('google', undefined, res);
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_unavailable',
      );
      expect(cookies.set).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown provider', () => {
      const { controller, res } = build();
      expect(() => controller.authorize('facebook', undefined, res)).toThrow(
        NotFoundException,
      );
    });
  });

  describe('callback', () => {
    const verified = {
      id: 'g1',
      email: 'ana@example.com',
      verified_email: true,
      name: 'Ana',
    };

    it('opens a session and resumes where the user was going', async () => {
      const { controller, res, cookies, identities, magicLinks, reqWith } =
        build();
      const { state, cookieValue } = createOAuthState(
        '/mcp/authorize?client_id=x',
      );
      mockGoogle(verified);
      await controller.callback(
        'google',
        'code',
        state,
        undefined,
        reqWith(cookieValue),
        res,
      );

      expect(identities.findOrCreateUserByOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          providerUserId: 'g1',
          email: 'ana@example.com',
        }),
      );
      expect(magicLinks.completeLogin).toHaveBeenCalledWith(
        { id: 'u1' },
        false,
        'oauth-google',
      );
      expect(cookies.set).toHaveBeenCalledWith(
        res,
        'session',
        'session-token',
        expect.any(Date),
      );
      expect(cookies.clear).toHaveBeenCalledWith(res, 'oauth_state');
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/mcp/authorize?client_id=x',
      );
    });

    it('rejects a forged state without exchanging the code or creating a session', async () => {
      const { controller, res, magicLinks, reqWith } = build();
      const { cookieValue } = createOAuthState(undefined);
      const fetchSpy = mockGoogle(verified);
      await controller.callback(
        'google',
        'code',
        'forged',
        undefined,
        reqWith(cookieValue),
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_failed',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(magicLinks.completeLogin).not.toHaveBeenCalled();
    });

    it('rejects a callback that has no state cookie', async () => {
      const { controller, res, magicLinks, reqWith } = build();
      const { state } = createOAuthState(undefined);
      await controller.callback(
        'google',
        'code',
        state,
        undefined,
        reqWith(undefined),
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_failed',
      );
      expect(magicLinks.completeLogin).not.toHaveBeenCalled();
    });

    it('does not sign in with an unverified provider email', async () => {
      const { controller, res, identities, reqWith } = build();
      const { state, cookieValue } = createOAuthState(undefined);
      mockGoogle({ ...verified, verified_email: false });
      await controller.callback(
        'google',
        'code',
        state,
        undefined,
        reqWith(cookieValue),
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_email_unverified',
      );
      expect(identities.findOrCreateUserByOAuth).not.toHaveBeenCalled();
    });

    it('tells apart a user who cancelled at the provider', async () => {
      const { controller, res, reqWith } = build();
      const { state, cookieValue } = createOAuthState(undefined);
      await controller.callback(
        'google',
        undefined,
        state,
        'access_denied',
        reqWith(cookieValue),
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_denied',
      );
    });

    it('lands on the login screen, not on an error page, when provisioning fails', async () => {
      const { controller, res, identities, reqWith } = build();
      identities.findOrCreateUserByOAuth.mockRejectedValue(
        new Error('db down'),
      );
      const { state, cookieValue } = createOAuthState(undefined);
      mockGoogle(verified);
      await controller.callback(
        'google',
        'code',
        state,
        undefined,
        reqWith(cookieValue),
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/login?error=oauth_failed',
      );
    });
  });
});
