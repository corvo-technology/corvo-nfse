import 'dotenv/config';

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL is required. Refusing to use DATABASE_URL for destructive E2E setup.',
  );
}

const parsed = new URL(e2eDatabaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');
const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
if (!localHosts.has(parsed.hostname)) {
  throw new Error(
    `E2E_DATABASE_URL must use a local PostgreSQL host, received ${parsed.hostname}`,
  );
}
if (!databaseName.toLowerCase().includes('test')) {
  throw new Error(
    `E2E database name must contain "test", received "${databaseName}"`,
  );
}
if (databaseName === 'greenflow_dev') {
  throw new Error(
    'Refusing to run destructive E2E setup against greenflow_dev',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = e2eDatabaseUrl;
process.env.DB_SCHEMA = 'corvo';
