/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return */
import 'dotenv/config';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from './typeorm.options';

function booleanFromEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase() ?? '');
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid PostgreSQL schema name: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureMigrationSchema(input: {
  url: string;
  schema: string;
  ssl: boolean;
}): Promise<void> {
  const client = new Client({
    connectionString: input.url,
    ssl: input.ssl ? { rejectUnauthorized: false } : false,
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
const ssl = booleanFromEnv(process.env.DB_SSL);

if (!databaseUrl && nodeEnv === 'production') {
  throw new Error('DATABASE_URL is required to run TypeORM migrations');
}

const migrationOptions = createTypeOrmOptions({
  url: databaseUrl ?? 'postgresql://corvo:changeme@localhost:5434/corvo_dev',
  schema,
  ssl,
  logging: booleanFromEnv(process.env.DB_LOGGING),
});

const dataSource = new DataSource(migrationOptions);

const initialize = dataSource.initialize.bind(dataSource);

dataSource.initialize = async function initializeWithMigrationSchema() {
  await ensureMigrationSchema({
    url: databaseUrl ?? 'postgresql://corvo:changeme@localhost:5434/corvo_dev',
    schema,
    ssl,
  });

  return initialize();
};

export default dataSource;
