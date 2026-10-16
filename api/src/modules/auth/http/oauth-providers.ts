export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type OAuthFailureReason = 'provider_error' | 'email_unverified';

export class OAuthProfileError extends Error {
  constructor(
    readonly reason: OAuthFailureReason,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    throw new OAuthProfileError(
      'provider_error',
      `${what} failed: ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

/** Google profile. The email must be verified: it is what links the account. */
export async function fetchGoogleProfile(
  client: OAuthClientConfig,
  code: string,
): Promise<OAuthProfile> {
  const token = await json<{ access_token?: string }>(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUrl,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    'Google token exchange',
  );
  if (!token.access_token) {
    throw new OAuthProfileError(
      'provider_error',
      'Google returned no access token',
    );
  }
  const user = await json<{
    id: string;
    email?: string;
    verified_email?: boolean;
    name?: string;
    picture?: string;
  }>(
    await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    'Google userinfo',
  );
  if (!user.email || user.verified_email !== true) {
    throw new OAuthProfileError(
      'email_unverified',
      'Google email is not verified',
    );
  }
  const email = user.email.trim().toLowerCase();
  return {
    providerUserId: String(user.id),
    email,
    name: user.name?.trim() || email.split('@')[0],
    avatarUrl: user.picture ?? null,
  };
}

/** GitHub profile. Only a verified address is accepted, never the public profile email alone. */
export async function fetchGitHubProfile(
  client: OAuthClientConfig,
  code: string,
): Promise<OAuthProfile> {
  const token = await json<{ access_token?: string }>(
    await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: client.redirectUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    'GitHub token exchange',
  );
  // GitHub answers 200 with an `error` field when the code is wrong or expired.
  if (!token.access_token) {
    throw new OAuthProfileError(
      'provider_error',
      'GitHub returned no access token',
    );
  }
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'corvo-nfse',
  };
  const user = await json<{
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  }>(
    await fetch('https://api.github.com/user', {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    'GitHub user',
  );
  const emails = await json<
    { email: string; primary: boolean; verified: boolean }[]
  >(
    await fetch('https://api.github.com/user/emails', {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    'GitHub emails',
  );
  const chosen =
    emails.find((entry) => entry.primary && entry.verified) ??
    emails.find((entry) => entry.verified);
  if (!chosen) {
    throw new OAuthProfileError(
      'email_unverified',
      'GitHub has no verified email',
    );
  }
  return {
    providerUserId: String(user.id),
    email: chosen.email.trim().toLowerCase(),
    name: user.name?.trim() || user.login,
    avatarUrl: user.avatar_url ?? null,
  };
}
