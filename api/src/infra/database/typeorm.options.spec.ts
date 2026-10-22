import {
  createDatabaseSsl,
  createNestTypeOrmOptions,
  createTypeOrmOptions,
} from './typeorm.options';

describe('database TLS', () => {
  it('is off when SSL is not requested', () => {
    expect(createDatabaseSsl({ ssl: false })).toBe(false);
  });

  it('verifies the server certificate by default', () => {
    expect(createDatabaseSsl({ ssl: true })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('accepts a CA with escaped newlines and keeps verification on', () => {
    expect(
      createDatabaseSsl({
        ssl: true,
        sslCa: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
      }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    });
  });

  it('only skips verification when disabled explicitly', () => {
    const ssl = createDatabaseSsl({ ssl: true, sslRejectUnauthorized: false });

    expect(ssl).not.toBe(false);
    expect(
      (ssl as { rejectUnauthorized: boolean }).rejectUnauthorized,
    ).toBeFalsy();
  });
});

describe('typeorm options', () => {
  const database = {
    url: 'postgresql://user:pass@localhost:5432/db',
    ssl: false,
    logging: false,
  };

  it('uses the configured application schema without a startup search_path', () => {
    const options = createTypeOrmOptions({
      ...database,
      schema: 'custom_greenflow',
    });

    expect(options).toMatchObject({
      schema: 'custom_greenflow',
    });
    expect(options.extra).toMatchObject({
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
      maxLifetimeSeconds: 1800,
    });
  });

  it('defaults the application schema to corvo', () => {
    const options = createTypeOrmOptions(database);

    expect(options).toMatchObject({
      schema: 'corvo',
    });
    expect(options.extra).not.toHaveProperty('options');
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

  it('propagates client-side PostgreSQL pool controls without startup parameters', () => {
    const options = createTypeOrmOptions({
      ...database,
      pool: {
        max: 24,
        min: 2,
        idleTimeoutMs: 45_000,
        connectionTimeoutMs: 2_000,
        maxLifetimeSeconds: 900,
      },
    });

    expect(options.extra).toMatchObject({
      max: 24,
      min: 2,
      idleTimeoutMillis: 45_000,
      connectionTimeoutMillis: 2_000,
      maxLifetimeSeconds: 900,
    });
    expect(options.extra).not.toHaveProperty('statement_timeout');
    expect(options.extra).not.toHaveProperty('application_name');
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
