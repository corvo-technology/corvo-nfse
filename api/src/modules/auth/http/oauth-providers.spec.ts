import {
  OAuthProfileError,
  fetchGitHubProfile,
  fetchGoogleProfile,
} from './oauth-providers';

const client = {
  clientId: 'id',
  clientSecret: 'secret',
  redirectUrl: 'https://corvo.tech/api/proxy/v1/auth/oauth/x/callback',
};

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function stubFetch(routes: Record<string, unknown>) {
  return jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = urlOf(input);
    const key = Object.keys(routes).find((route) => url.startsWith(route));
    if (!key) return reply({ message: `unexpected ${url}` }, 500);
    return reply(routes[key]);
  });
}

afterEach(() => jest.restoreAllMocks());

describe('fetchGoogleProfile', () => {
  const token = {
    'https://oauth2.googleapis.com/token': { access_token: 't' },
  };

  it('returns a normalized profile for a verified email', async () => {
    stubFetch({
      ...token,
      'https://www.googleapis.com/oauth2/v2/userinfo': {
        id: '123',
        email: 'Ana@Example.com',
        verified_email: true,
        name: 'Ana',
        picture: 'https://img/x.png',
      },
    });
    await expect(fetchGoogleProfile(client, 'code')).resolves.toEqual({
      providerUserId: '123',
      email: 'ana@example.com',
      name: 'Ana',
      avatarUrl: 'https://img/x.png',
    });
  });

  it('refuses an unverified email, which would allow taking over an account', async () => {
    stubFetch({
      ...token,
      'https://www.googleapis.com/oauth2/v2/userinfo': {
        id: '1',
        email: 'victim@example.com',
        verified_email: false,
      },
    });
    await expect(fetchGoogleProfile(client, 'code')).rejects.toMatchObject({
      reason: 'email_unverified',
    });
  });

  it('fails cleanly when the code exchange is rejected', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => reply({ error: 'invalid_grant' }, 400));
    await expect(fetchGoogleProfile(client, 'bad')).rejects.toBeInstanceOf(
      OAuthProfileError,
    );
  });
});

describe('fetchGitHubProfile', () => {
  const token = {
    'https://github.com/login/oauth/access_token': { access_token: 't' },
  };
  const user = {
    'https://api.github.com/user': {
      id: 42,
      login: 'ana',
      name: null,
      avatar_url: 'https://a/b.png',
    },
  };

  it('uses the primary verified email', async () => {
    stubFetch({
      ...token,
      'https://api.github.com/user/emails': [
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'Main@Example.com', primary: true, verified: true },
      ],
      ...user,
    });
    await expect(fetchGitHubProfile(client, 'code')).resolves.toEqual({
      providerUserId: '42',
      email: 'main@example.com',
      name: 'ana',
      avatarUrl: 'https://a/b.png',
    });
  });

  it('never picks an unverified address, even when it is the primary one', async () => {
    stubFetch({
      ...token,
      'https://api.github.com/user/emails': [
        { email: 'victim@example.com', primary: true, verified: false },
      ],
      ...user,
    });
    await expect(fetchGitHubProfile(client, 'code')).rejects.toMatchObject({
      reason: 'email_unverified',
    });
  });

  it('falls back to another verified address when the primary is unverified', async () => {
    stubFetch({
      ...token,
      'https://api.github.com/user/emails': [
        { email: 'victim@example.com', primary: true, verified: false },
        { email: 'mine@example.com', primary: false, verified: true },
      ],
      ...user,
    });
    await expect(fetchGitHubProfile(client, 'code')).resolves.toMatchObject({
      email: 'mine@example.com',
    });
  });

  it('treats a 200 answer without access_token (expired code) as a provider error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => reply({ error: 'bad_verification_code' }));
    await expect(fetchGitHubProfile(client, 'old')).rejects.toMatchObject({
      reason: 'provider_error',
    });
  });
});
