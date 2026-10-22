import { parseEnvConfig } from './env.schema';

describe('oauth environment configuration', () => {
  it('treats empty provider credentials as not configured', () => {
    const env = parseEnvConfig({
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
  });

  it('keeps configured provider credentials', () => {
    const env = parseEnvConfig({
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-client-secret',
    });
    expect(env.GOOGLE_CLIENT_ID).toBe('google-client-id');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('google-client-secret');
    expect(env.GITHUB_CLIENT_ID).toBe('github-client-id');
    expect(env.GITHUB_CLIENT_SECRET).toBe('github-client-secret');
  });
});
