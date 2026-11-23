import { parseEnvConfig } from './env.schema';

describe('DEPLOYMENT_MODE', () => {
  const base = { NODE_ENV: 'production' };
  const production = {
    DATABASE_URL: 'postgresql://runtime:password@postgres/corvo',
    REDIS_URL: 'redis://redis:6379',
    AUTH_JWT_SECRET: 'jwt-secret-at-least-thirty-two-characters',
    AUTH_CSRF_SIGNING_SECRET: 'csrf-secret-at-least-thirty-two-characters',
    PUBLIC_CUSTOMER_SESSION_HMAC_SECRET:
      'session-secret-at-least-thirty-two-characters',
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    NFSE_MASTER_KEY: 'certificate-secret-at-least-thirty-two-characters',
    OTP_HMAC_SECRET: 'otp-secret-at-least-thirty-two-characters',
    RESEND_API_KEY: 'ms_test_fixture',
    PUBLIC_API_URL: 'https://api.corvo.example',
    STORAGE_PROVIDER: 's3',
    STORAGE_S3_ENDPOINT: 'https://s3.example.com',
    STORAGE_S3_ACCESS_KEY_ID: 'fixture-access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret-key',
    ...base,
  };

  it('defaults to cloud', () => {
    expect(
      parseEnvConfig({
        ...production,
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_PLATFORM_WEBHOOK_SECRET: 'wh',
      }).DEPLOYMENT_MODE,
    ).toBe('cloud');
  });

  it('keeps requiring Stripe in cloud', () => {
    expect(() => parseEnvConfig(production)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      parseEnvConfig({ ...production, DEPLOYMENT_MODE: 'cloud' }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('keeps stripe as the default payment provider in cloud', () => {
    expect(
      parseEnvConfig({
        ...production,
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_PLATFORM_WEBHOOK_SECRET: 'wh',
      }).PAYMENT_ALLOWED_PROVIDERS,
    ).toBe('stripe');
  });

  it('rejects an unknown value', () => {
    expect(() =>
      parseEnvConfig({ ...production, DEPLOYMENT_MODE: 'selfhosted' }),
    ).toThrow(/DEPLOYMENT_MODE/);
  });

  it('boots self_hosted without any STRIPE_* variable and without payment providers', () => {
    const config = parseEnvConfig({
      ...production,
      DEPLOYMENT_MODE: 'self_hosted',
    });
    expect(config.DEPLOYMENT_MODE).toBe('self_hosted');
    expect(config.PAYMENT_ALLOWED_PROVIDERS).toBe('');
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('lets self_hosted opt back into a provider explicitly', () => {
    const config = parseEnvConfig({
      ...production,
      DEPLOYMENT_MODE: 'self_hosted',
      PAYMENT_ALLOWED_PROVIDERS: 'stripe',
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_PLATFORM_WEBHOOK_SECRET: 'wh',
    });
    expect(config.PAYMENT_ALLOWED_PROVIDERS).toBe('stripe');
  });

  it('reports the signup mode: open in cloud, closed in self_hosted, overridable', () => {
    expect(parseEnvConfig({ NODE_ENV: 'test' }).AUTH_SIGNUP_MODE).toBe('open');
    expect(
      parseEnvConfig({ NODE_ENV: 'test', DEPLOYMENT_MODE: 'self_hosted' })
        .AUTH_SIGNUP_MODE,
    ).toBe('closed');
    expect(
      parseEnvConfig({
        NODE_ENV: 'test',
        DEPLOYMENT_MODE: 'self_hosted',
        AUTH_SIGNUP_MODE: 'allowlist',
      }).AUTH_SIGNUP_MODE,
    ).toBe('allowlist');
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', AUTH_SIGNUP_MODE: 'x' }),
    ).toThrow(/AUTH_SIGNUP_MODE/);
  });
});
