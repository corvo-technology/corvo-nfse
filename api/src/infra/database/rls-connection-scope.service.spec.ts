import type { DataSource } from 'typeorm';
import { RlsConnectionScopeService } from './rls-connection-scope.service';
import { TENANT_RLS_TABLES } from './rls-tables';

jest.mock('./rls-connection-scope', () => ({
  installRlsConnectionScope: jest.fn(),
}));

describe('RlsConnectionScopeService integration tables', () => {
  beforeEach(() => {
    process.env.RLS_MIGRATIONS_WAIT_TIMEOUT_MS = '0';
  });
  afterEach(() => {
    delete process.env.RLS_MIGRATIONS_WAIT_TIMEOUT_MS;
  });

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

describe('RlsConnectionScopeService waiting for migrations', () => {
  const role = [{ rolsuper: false, rolbypassrls: false }];
  const all = TENANT_RLS_TABLES.map((relname) => ({ relname }));
  const partial = all.slice(1);

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.RLS_MIGRATIONS_WAIT_TIMEOUT_MS = '20000';
    process.env.RLS_MIGRATIONS_WAIT_INTERVAL_MS = '3000';
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.RLS_MIGRATIONS_WAIT_TIMEOUT_MS;
    delete process.env.RLS_MIGRATIONS_WAIT_INTERVAL_MS;
  });

  function build(query: jest.Mock) {
    const svc = new RlsConnectionScopeService({
      options: { schema: 'corvo' },
      query,
    } as unknown as DataSource);
    const warn = jest
      .spyOn(
        (svc as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation();
    return { svc, warn };
  }

  it('boots when the policies appear on the 3rd try', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(role)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(all);
    const { svc, warn } = build(query);
    const done = svc.onModuleInit();
    await jest.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain(
      `Waiting for migrations (missing: ${TENANT_RLS_TABLES[0]})`,
    );
  });

  it('throws after the timeout when the policies never appear', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(role)
      .mockResolvedValue(partial);
    const { svc, warn } = build(query);
    const done = svc.onModuleInit();
    const assertion = expect(done).rejects.toThrow(
      'Tenant RLS policies are missing',
    );
    await jest.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(warn).toHaveBeenCalled();
  });

  it('does not report each retry to Sentry', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nestjs') as { captureException: jest.Mock };
    const spy = jest.spyOn(Sentry, 'captureException');
    const query = jest
      .fn()
      .mockResolvedValueOnce(role)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(all);
    const { svc } = build(query);
    const done = svc.onModuleInit();
    await jest.advanceTimersByTimeAsync(3000);
    await done;
    expect(spy).not.toHaveBeenCalled();
  });
});
