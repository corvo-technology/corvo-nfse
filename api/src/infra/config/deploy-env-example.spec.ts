import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parseEnvConfig } from './env.schema';

// Keys only Docker Compose, the web or the setup script read; the API schema does not know them.
const composeOnly = new Set([
  'WEB_PORT',
  'API_PORT',
  'WEB_BIND_ADDRESS',
  'API_BIND_ADDRESS',
  'WEB_DOMAIN',
  'API_DOMAIN',
  'APP_ORIGIN',
  'POSTGRES_PASSWORD',
  'POSTGRES_RUNTIME_PASSWORD',
  'PROXY_SHARED_SECRET',
  'TRUST_CF_CONNECTING_IP',
]);

const example = readFileSync(
  join(__dirname, '../../../../deploy/.env.example'),
  'utf8',
);
const values = parseEnv(example);

describe('deploy/.env.example', () => {
  it('boots the API once its placeholders are filled in', () => {
    const filled = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        /<.*>/.test(value)
          ? key.endsWith('ENDPOINT')
            ? 'https://s3.example.com'
            : 'x'.repeat(40)
          : value,
      ]),
    );
    const config = parseEnvConfig({
      ...filled,
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      DATABASE_URL: 'postgresql://runtime:pw@postgres:5432/corvo_dev',
      REDIS_URL: 'redis://redis:6379',
    });
    expect(config.DEPLOYMENT_MODE).toBe('self_hosted');
    expect(config.NFE_PRODUCTION_ENABLED).toBe(false);
    expect(config.DATA_RETENTION_ENABLED).toBe(false);
  });

  it('lists every key the API needs in production and not the removed NFE_ENABLED', () => {
    expect(example).not.toMatch(/^#?\s*NFE_ENABLED=/m);
    for (const key of [
      'PUBLIC_API_URL',
      'OTP_HMAC_SECRET',
      'NFSE_MASTER_KEY',
      'RESEND_API_KEY',
      'SECRETS_ENCRYPTION_KEY',
      'PUBLIC_CUSTOMER_SESSION_HMAC_SECRET',
      'AUTH_JWT_SECRET',
      'AUTH_CSRF_SIGNING_SECRET',
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ]) {
      expect(values).toHaveProperty(key);
    }
  });

  it('only sets keys the API schema or Compose know', () => {
    const source = readFileSync(join(__dirname, 'env.schema.ts'), 'utf8');
    const known = new Set(
      [...source.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]),
    );
    const unknown = Object.keys(values).filter(
      (key) => !known.has(key) && !composeOnly.has(key),
    );
    expect(unknown).toEqual([]);
  });
});
