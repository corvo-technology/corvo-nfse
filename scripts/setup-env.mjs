import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const deploySecrets = {
  POSTGRES_PASSWORD: () => randomBytes(24).toString('hex'),
  POSTGRES_RUNTIME_PASSWORD: () => randomBytes(24).toString('hex'),
  AUTH_JWT_SECRET: () => randomBytes(32).toString('hex'),
  AUTH_CSRF_SIGNING_SECRET: () => randomBytes(32).toString('hex'),
  PUBLIC_CUSTOMER_SESSION_HMAC_SECRET: () => randomBytes(32).toString('hex'),
  SECRETS_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  NFSE_MASTER_KEY: () => randomBytes(32).toString('hex'),
  OTP_HMAC_SECRET: () => randomBytes(32).toString('hex'),
};

const files = [
  ['api/.env.example', 'api/.env', {
    AUTH_JWT_SECRET: () => randomBytes(32).toString('hex'),
    AUTH_CSRF_SIGNING_SECRET: () => randomBytes(32).toString('hex'),
    SECRETS_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
    NFSE_MASTER_KEY: () => randomBytes(32).toString('hex'),
    OTP_HMAC_SECRET: () => randomBytes(32).toString('hex'),
  }],
  ['web/.env.example', 'web/.env.local', {}],
  ['deploy/.env.example', 'deploy/.env', deploySecrets],
  ['deploy/.env.local.example', 'deploy/.env.local', deploySecrets],
];

for (const [source, target, values] of files) {
  let content = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  for (const [key, generate] of Object.entries(values)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${generate()}`);
  }
  try {
    await writeFile(new URL(`../${target}`, import.meta.url), content, { flag: 'wx', mode: 0o600 });
    console.log(`Created ${target}.`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${target}.`);
  }
}
