import type { DataSource } from 'typeorm';
import { schemaQualifier } from './schema-qualifier';

const ds = (options: Record<string, unknown>) =>
  ({ options }) as unknown as DataSource;

describe('schemaQualifier', () => {
  it('qualifica com o schema do DataSource', () => {
    expect(schemaQualifier(ds({ schema: 'app_1' }))('auth_users')).toBe(
      '"app_1"."auth_users"',
    );
  });

  it("usa 'corvo' sem schema nas opções", () => {
    expect(schemaQualifier(ds({}))('tenants')).toBe('"corvo"."tenants"');
  });

  it('recusa schema que não é identificador', () => {
    expect(() => schemaQualifier(ds({ schema: 'x"; y' }))).toThrow(
      'Invalid PostgreSQL schema name',
    );
  });

  it('recusa tabela que não é identificador', () => {
    expect(() => schemaQualifier(ds({}))('a"b')).toThrow(
      'Invalid PostgreSQL table name',
    );
  });
});
