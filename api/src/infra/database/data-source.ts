/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return */
import 'dotenv/config';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { createDatabaseSsl, createTypeOrmOptions } from './typeorm.options';

function booleanFromEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase() ?? '');
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid PostgreSQL schema name: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

const tls = {
  ssl: booleanFromEnv(process.env.DB_SSL),
  // Verification is on unless DB_SSL_REJECT_UNAUTHORIZED is set to a false value.
  sslRejectUnauthorized:
    process.env.DB_SSL_REJECT_UNAUTHORIZED === undefined ||
    booleanFromEnv(process.env.DB_SSL_REJECT_UNAUTHORIZED),
  sslCa: process.env.DB_SSL_CA,
};

async function ensureMigrationSchema(input: {
  url: string;
  schema: string;
}): Promise<void> {
  const client = new Client({
    connectionString: input.url,
    ssl: createDatabaseSsl(tls),
  });
  const schema = quoteIdentifier(input.schema);

  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await client.end();
  }
}

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const nodeEnv = process.env.NODE_ENV ?? 'development';
const schema = process.env.DB_SCHEMA ?? 'corvo';

if (!databaseUrl && nodeEnv === 'production') {
  throw new Error('DATABASE_URL is required to run TypeORM migrations');
}

const migrationOptions = createTypeOrmOptions({
  url: databaseUrl ?? 'postgresql://corvo:changeme@localhost:5434/corvo_dev',
  schema,
  ...tls,
  logging: booleanFromEnv(process.env.DB_LOGGING),
});

const dataSource = new DataSource(migrationOptions);

const initialize = dataSource.initialize.bind(dataSource);

dataSource.initialize = async function initializeWithMigrationSchema() {
  await ensureMigrationSchema({
    url: databaseUrl ?? 'postgresql://corvo:changeme@localhost:5434/corvo_dev',
    schema,
  });

  return initialize();
};

export default dataSource;
