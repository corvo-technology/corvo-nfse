import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

// The tax calculator image is built from the official zip; its address and checksum are pinned in the repo.
const rtcZipUrl = (await readFile(new URL('../deploy/rtc-zip-url.txt', import.meta.url), 'utf8')).trim();
const rtcZipSha256 = (await readFile(new URL('../docs/fiscal/rtc/ZIP_SHA256.txt', import.meta.url), 'utf8')).trim().split(/\s+/)[0];

// Optional: node scripts/setup-env.mjs --domain=corvo.tech --api-domain=api.corvo.tech [--force-deploy]
// --force-deploy replaces an existing deploy/.env (the old one is kept as deploy/.env.old).
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const domain = args.domain;
const apiDomain = args['api-domain'] ?? (domain ? `api.${domain}` : undefined);
const domainValues = domain
  ? {
      WEB_DOMAIN: () => domain,
      API_DOMAIN: () => apiDomain,
      APP_ORIGIN: () => `https://${domain}`,
      PUBLIC_API_URL: () => `https://${apiDomain}`,
    }
  : {};

const deploySecrets = {
  RTC_ZIP_URL: () => rtcZipUrl,
  RTC_ZIP_SHA256: () => rtcZipSha256,
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
  ['deploy/.env.example', 'deploy/.env', { ...deploySecrets, ...domainValues }],
  ['deploy/.env.local.example', 'deploy/.env.local', deploySecrets],
];

for (const [source, target, values] of files) {
  let content = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  for (const [key, generate] of Object.entries(values)) {
    content = content
      .split('\n')
      .map((line) => (line.startsWith(`${key}=`) ? `${key}=${generate()}` : line))
      .join('\n');
  }
  if (args['force-deploy'] && target === 'deploy/.env') {
    try {
      await rename(new URL(`../${target}`, import.meta.url), new URL(`../${target}.old`, import.meta.url));
      console.log(`Moved existing ${target} to ${target}.old.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    await writeFile(new URL(`../${target}`, import.meta.url), content, { flag: 'wx', mode: 0o600 });
    console.log(`Created ${target}.`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${target}.`);
  }
}
