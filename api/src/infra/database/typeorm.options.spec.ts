import {
  createNestTypeOrmOptions,
  createTypeOrmOptions,
} from './typeorm.options';

describe('typeorm options', () => {
  const database = {
    url: 'postgresql://user:pass@localhost:5432/db',
    ssl: false,
    logging: false,
  };

  it('uses the configured application schema and search_path', () => {
    const options = createTypeOrmOptions({
      ...database,
      schema: 'custom_greenflow',
    });

    expect(options).toMatchObject({
      schema: 'custom_greenflow',
    });
    expect(options.extra).toMatchObject({
      options: '-c search_path="custom_greenflow",public',
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
      maxLifetimeSeconds: 1800,
      statement_timeout: 0,
      application_name: 'corvo',
    });
  });

  it('defaults the application schema to corvo', () => {
    const options = createTypeOrmOptions(database);

    expect(options).toMatchObject({
      schema: 'corvo',
    });
    expect(options.extra).toMatchObject({
      options: '-c search_path="corvo",public',
    });
    expect(options.migrations).toEqual([
      expect.stringContaining('/migrations/**/!(*.spec){.ts,.js}'),
    ]);
    expect(options.migrationsTransactionMode).toBe('each');
  });

  it('rejects unsafe schema identifiers before opening a connection', () => {
    expect(() =>
      createTypeOrmOptions({
        ...database,
        schema: 'corvo; DROP SCHEMA public',
      }),
    ).toThrow('Invalid PostgreSQL schema name');
  });

  it('uses PostgreSQL built-in UUID generation without installing extensions', () => {
    expect(createTypeOrmOptions(database)).toMatchObject({
      uuidExtension: 'pgcrypto',
      installExtensions: false,
      synchronize: false,
    });
  });

  it('propagates explicit PostgreSQL pool controls', () => {
    const options = createTypeOrmOptions({
      ...database,
      pool: {
        max: 24,
        min: 2,
        idleTimeoutMs: 45_000,
        connectionTimeoutMs: 2_000,
        maxLifetimeSeconds: 900,
      },
      statementTimeoutMs: 8_000,
      applicationName: 'greenflow-api',
    });

    expect(options.extra).toMatchObject({
      max: 24,
      min: 2,
      idleTimeoutMillis: 45_000,
      connectionTimeoutMillis: 2_000,
      maxLifetimeSeconds: 900,
      statement_timeout: 8_000,
      application_name: 'greenflow-api',
    });
  });

  it('propagates manual initialization to Nest TypeORM options', () => {
    const options = createNestTypeOrmOptions({
      ...database,
      schema: 'custom_greenflow',
      manualInitialization: true,
    });

    expect(options).toMatchObject({
      schema: 'custom_greenflow',
    });
    expect(options.manualInitialization).toBe(true);
  });
});
