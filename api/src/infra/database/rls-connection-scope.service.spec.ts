import type { DataSource } from 'typeorm';
import { RlsConnectionScopeService } from './rls-connection-scope.service';
import { TENANT_RLS_TABLES } from './rls-tables';

jest.mock('./rls-connection-scope', () => ({
  installRlsConnectionScope: jest.fn(),
}));

describe('RlsConnectionScopeService integration tables', () => {
  function service(missing?: string) {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: false }])
      .mockResolvedValueOnce(
        TENANT_RLS_TABLES.filter((name) => name !== missing).map((relname) => ({
          relname,
        })),
      );
    return new RlsConnectionScopeService({
      options: { schema: 'custom_schema' },
      query,
    } as unknown as DataSource);
  }

  it.each([
    'integration_connections',
    'integration_rules',
    'integration_operations',
    'integration_events',
  ])('refuses startup when %s is missing RLS protection', async (table) => {
    await expect(service(table).onModuleInit()).rejects.toThrow(
      'Tenant RLS policies are missing',
    );
  });

  it('accepts a restricted role with all required policies', async () => {
    await expect(service().onModuleInit()).resolves.toBeUndefined();
  });
});
