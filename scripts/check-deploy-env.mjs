import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const config = parseEnv(await readFile(new URL('../deploy/.env', import.meta.url), 'utf8'));
const errors = [];
const proxy = process.argv.includes('--proxy');
const required = [
  'POSTGRES_PASSWORD', 'POSTGRES_RUNTIME_PASSWORD',
  'AUTH_JWT_SECRET', 'AUTH_CSRF_SIGNING_SECRET', 'PUBLIC_CUSTOMER_SESSION_HMAC_SECRET',
  'SECRETS_ENCRYPTION_KEY', 'NFSE_MASTER_KEY', 'OTP_HMAC_SECRET',
  'APP_ORIGIN', 'PUBLIC_API_URL',
  'STORAGE_S3_BUCKET', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_REGION',
  'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY',
  'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PLATFORM_WEBHOOK_SECRET',
];
if (proxy) required.push('WEB_DOMAIN', 'API_DOMAIN');
for (const key of required) {
  if (!config[key] || /[<>]|example\.com|_placeholder/.test(config[key])) errors.push(`Configure ${key}.`);
}
if (config.NODE_ENV !== 'production') errors.push('NODE_ENV must be production.');
if (config.CORVO_ENV_FILE && config.CORVO_ENV_FILE !== '.env') errors.push('Production must use deploy/.env.');
if (config.STORAGE_PROVIDER !== 's3') errors.push('STORAGE_PROVIDER must be s3.');
for (const [key, domain] of [['APP_ORIGIN', 'WEB_DOMAIN'], ['PUBLIC_API_URL', 'API_DOMAIN']]) {
  try {
    const url = new URL(config[key]);
    if (url.protocol !== 'https:' || url.origin !== config[key]) {
      errors.push(`${key} must be an HTTPS origin without a path or trailing slash.`);
    }
    if (proxy && url.hostname !== config[domain]) errors.push(`${domain} must match the hostname in ${key}.`);
  } catch { errors.push(`${key} must be a valid HTTPS origin.`); }
}
try {
  const endpoint = new URL(config.STORAGE_S3_ENDPOINT);
  if (endpoint.protocol !== 'https:' || /localhost|localstack|127\.0\.0\.1/.test(endpoint.hostname)) {
    errors.push('STORAGE_S3_ENDPOINT must point to external S3 storage over HTTPS.');
  }
} catch { errors.push('Set a valid STORAGE_S3_ENDPOINT.'); }
for (const key of ['AUTH_JWT_SECRET', 'AUTH_CSRF_SIGNING_SECRET', 'PUBLIC_CUSTOMER_SESSION_HMAC_SECRET', 'NFSE_MASTER_KEY', 'OTP_HMAC_SECRET']) {
  if ((config[key]?.length ?? 0) < 32) errors.push(`${key} must contain at least 32 characters.`);
}
if (Buffer.from(config.SECRETS_ENCRYPTION_KEY ?? '', 'base64').length !== 32) {
  errors.push('SECRETS_ENCRYPTION_KEY must contain 32 bytes encoded as base64.');
}
for (const key of ['POSTGRES_PASSWORD', 'POSTGRES_RUNTIME_PASSWORD']) {
  if (!/^[A-Za-z0-9_-]+$/.test(config[key] ?? '')) errors.push(`${key} must use URL-safe characters (setup generates hexadecimal).`);
}
if (config.TURNSTILE_DEVELOPMENT_BYPASS_ENABLED !== 'false') errors.push('Set TURNSTILE_DEVELOPMENT_BYPASS_ENABLED=false in production.');
if (errors.length) {
  console.error('Update deploy/.env before starting production:\n' + [...new Set(errors)].map((message) => `- ${message}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Production configuration validated. Secret values are not displayed.');
}
