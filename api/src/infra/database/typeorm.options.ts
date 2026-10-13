import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';

export type TypeOrmDatabaseConfig = {
  url: string;
  schema?: string;
  ssl: boolean;
  logging: boolean;
  manualInitialization?: boolean;
  pool?: {
    max: number;
    min: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    maxLifetimeSeconds: number;
  };
  statementTimeoutMs?: number;
  applicationName?: string;
};

const DEFAULT_APPLICATION_SCHEMA = 'corvo';

export function createTypeOrmOptions(
  database: TypeOrmDatabaseConfig,
): DataSourceOptions {
  const schema = database.schema ?? DEFAULT_APPLICATION_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error('Invalid PostgreSQL schema name');
  }
  return {
    type: 'postgres',
    url: database.url,
    synchronize: false,
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    schema,
    logging: database.logging ? ['query', 'error'] : false,
    logger: database.logging ? 'advanced-console' : undefined,
    ssl: database.ssl ? { rejectUnauthorized: false } : false,
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    extra: {
      options: `-c search_path="${schema}",public`,
      max: database.pool?.max ?? 10,
      min: database.pool?.min ?? 0,
      idleTimeoutMillis: database.pool?.idleTimeoutMs ?? 30000,
      connectionTimeoutMillis: database.pool?.connectionTimeoutMs ?? 3000,
      maxLifetimeSeconds: database.pool?.maxLifetimeSeconds ?? 1800,
      statement_timeout: database.statementTimeoutMs ?? 0,
      application_name: database.applicationName ?? 'corvo',
    },
    entities: [
      __dirname + '/../persistence/typeorm/**/*.orm-entity{.ts,.js}',
      __dirname + '/../persistence/typeorm/**/*.orm-entities{.ts,.js}',
      __dirname + '/../../modules/**/*.orm-entity{.ts,.js}',
      __dirname + '/../../modules/**/*.entity{.ts,.js}',
    ],
    // Migration tests live beside migrations. Restrict discovery to the
    // timestamped executable files so the TypeORM CLI never imports *.spec.ts.
    migrations: [__dirname + '/migrations/**/!(*.spec){.ts,.js}'],
    // Allows individual online migrations to opt out for
    // CREATE/DROP INDEX CONCURRENTLY while keeping every other migration atomic.
    migrationsTransactionMode: 'each',
  };
}

export function createNestTypeOrmOptions(
  database: TypeOrmDatabaseConfig,
): TypeOrmModuleOptions {
  return {
    ...createTypeOrmOptions(database),
    autoLoadEntities: true,
    manualInitialization: database.manualInitialization ?? false,
  };
}
