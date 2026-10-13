import 'dotenv/config';
import { randomUUID, randomBytes } from 'node:crypto';
const url = new URL(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Fiscal integration requires local PostgreSQL');
url.pathname = '/corvo_test';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url.toString();
process.env.DB_SCHEMA = `fiscal_${randomUUID().replaceAll('-', '')}`;
process.env.REDIS_KEY_PREFIX = process.env.DB_SCHEMA;
process.env.STORAGE_PROVIDER = 's3';
process.env.STORAGE_S3_ENDPOINT =
  process.env.E2E_STORAGE_S3_ENDPOINT ?? 'http://127.0.0.1:4566';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'test';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'test';
process.env.STORAGE_S3_BUCKET = process.env.DB_SCHEMA.replaceAll('_', '-');
process.env.NFSE_MASTER_KEY = randomBytes(32).toString('base64');
process.env.SENTRY_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.DB_POOL_MIN = '0';
process.env.DB_POOL_MAX = '10';
process.env.DB_POOL_CONNECTION_TIMEOUT_MS = '15000';
