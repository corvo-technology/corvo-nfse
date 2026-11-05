import { parseEnvConfig } from './env.schema';

const base = { NODE_ENV: 'test' };
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://runtime:password@postgres/corvo_dev',
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
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_PLATFORM_WEBHOOK_SECRET: 'whsec_fixture',
  STORAGE_PROVIDER: 's3',
  STORAGE_S3_ENDPOINT: 'https://s3.example.com',
  STORAGE_S3_ACCESS_KEY_ID: 'fixture-access-key',
  STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret-key',
};

describe('woovi payment provider environment', () => {
  it('accepts woovi as an allowed provider', () => {
    const env = parseEnvConfig({
      ...base,
      PAYMENT_ALLOWED_PROVIDERS: 'stripe,woovi',
    });
    expect(env.PAYMENT_ALLOWED_PROVIDERS).toBe('stripe,woovi');
  });
  it('still rejects unknown providers', () => {
    expect(() =>
      parseEnvConfig({ ...base, PAYMENT_ALLOWED_PROVIDERS: 'stripe,paypal' }),
    ).toThrow(/Unsupported payment provider: paypal/);
  });
  it('defaults the Woovi API url', () => {
    expect(parseEnvConfig(base).WOOVI_API_URL).toBe(
      'https://api.woovi.com/api/v1',
    );
  });
  it('requires the app id and webhook token outside test when woovi is enabled', () => {
    expect(() =>
      parseEnvConfig({
        ...production,
        PAYMENT_ALLOWED_PROVIDERS: 'stripe,woovi',
      }),
    ).toThrow(/WOOVI_APP_ID is required when Woovi is enabled/);
    expect(() =>
      parseEnvConfig({
        ...production,
        PAYMENT_ALLOWED_PROVIDERS: 'stripe,woovi',
        WOOVI_APP_ID: 'app',
      }),
    ).toThrow(/WOOVI_WEBHOOK_TOKEN is required when Woovi is enabled/);
    expect(
      parseEnvConfig({
        ...production,
        PAYMENT_ALLOWED_PROVIDERS: 'stripe,woovi',
        WOOVI_APP_ID: 'app',
        WOOVI_WEBHOOK_TOKEN: 'token-at-least-16-chars',
      }).WOOVI_APP_ID,
    ).toBe('app');
  });
});
