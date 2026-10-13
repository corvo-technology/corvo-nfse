import { parseEnvConfig } from './env.schema';

describe('NFS-e deployment environment', () => {
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

  it('boots NFS-e production without unused WhatsApp or Meta credentials', () => {
    const config = parseEnvConfig(production);
    expect(config.NODE_ENV).toBe('production');
    expect(config.META_APP_ID).toBeUndefined();
    expect(config.WHATSAPP_WEBHOOK_VERIFY_TOKEN).toBeUndefined();
  });

  it('boots development without unused WhatsApp or Meta credentials', () => {
    expect(
      parseEnvConfig({ ...production, NODE_ENV: 'development' }).NODE_ENV,
    ).toBe('development');
  });

  it.each(['OTP_HMAC_SECRET', 'NFSE_MASTER_KEY', 'RESEND_API_KEY'])(
    'still requires %s in production',
    (key) => {
      expect(() =>
        parseEnvConfig({ ...production, [key]: undefined }),
      ).toThrow();
    },
  );

  it('still requires external document storage in production', () => {
    expect(() =>
      parseEnvConfig({ ...production, STORAGE_PROVIDER: 'unavailable' }),
    ).toThrow();
  });
});
