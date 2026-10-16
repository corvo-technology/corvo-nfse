import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createSeededE2eApp,
  closeE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

jest.setTimeout(180_000);

const CALLBACK = 'https://corvo.tech/api/proxy/v1/auth/oauth/google/callback';

describe('Social sign-in (e2e)', () => {
  let ctx: E2eTestApp;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_REDIRECT_URL = CALLBACK;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_REDIRECT_URL;
    ctx = await createSeededE2eApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('is reachable without a session and reports only the configured provider', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/oauth/providers')
      .expect(200);
    expect(res.body).toEqual({ data: { google: true, github: false } });
  });

  it('redirects to Google with the state in a single-use cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/oauth/google/authorize')
      .query({ next: '/mcp/authorize?client_id=x' })
      .expect(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK);
    const state = location.searchParams.get('state') as string;
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (entry) => entry.startsWith('gf_oauth_state_dev='),
    ) as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(decodeURIComponent(cookie.split(';')[0])).toContain(state);
  });

  it('sends an unconfigured provider back to the login screen', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/oauth/github/authorize')
      .expect(302);
    expect(res.headers.location).toBe('/login?error=oauth_unavailable');
  });

  it('refuses a callback whose state does not match, without signing anyone in', async () => {
    const start = await request(app.getHttpServer()).get(
      '/v1/auth/oauth/google/authorize',
    );
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
    const res = await request(app.getHttpServer())
      .get('/v1/auth/oauth/google/callback')
      .query({ code: 'code', state: 'forged' })
      .set('Cookie', cookie)
      .expect(302);
    expect(res.headers.location).toBe('/login?error=oauth_failed');
    const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((entry) => entry.startsWith('gf_session_dev='))).toBe(false);
  });

  it('turns a callback with no cookie into a login error, not a server error', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/oauth/google/callback')
      .query({ code: 'code', state: 'whatever' })
      .expect(302);
    expect(res.headers.location).toBe('/login?error=oauth_failed');
  });

  it('answers 404 for an unknown provider', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/oauth/facebook/authorize')
      .expect(404);
  });
});
