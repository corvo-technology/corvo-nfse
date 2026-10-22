import type { QueryRunner } from 'typeorm';
import { BackfillCompanyFiscalNormalization1791700000000 } from './1791700000000-BackfillCompanyFiscalNormalization';

function fakeRunner(duplicates: unknown[] = []) {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return /GROUP BY/i.test(sql) &&
        /SELECT/i.test(sql) &&
        !/UPDATE/i.test(sql)
        ? duplicates
        : undefined;
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('BackfillCompanyFiscalNormalization', () => {
  it('normalizes tax_id and zip, then recomputes status without touching blocked', async () => {
    const { runner, queries } = fakeRunner();
    await new BackfillCompanyFiscalNormalization1791700000000().up(runner);
    const sql = queries.join('\n');
    expect(sql).toMatch(
      /UPDATE "corvo"\.nfse_companies[\s\S]*regexp_replace\(tax_id/,
    );
    expect(sql).toMatch(/address_zip/);
    expect(sql).toMatch(/status <> 'blocked'/);
    expect(sql).toMatch(/nfse_certificates/);
  });

  it('skips rows whose normalization would collide on the unique index and reports them', async () => {
    const { runner, queries } = fakeRunner([
      { tenant_id: 't', environment: 'test', norm: 'X', ids: ['a', 'b'] },
    ]);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await new BackfillCompanyFiscalNormalization1791700000000().up(runner);
    expect(queries.join('\n')).toMatch(/NOT EXISTS/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('down is a no-op', async () => {
    const { runner } = fakeRunner();
    await new BackfillCompanyFiscalNormalization1791700000000().down(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
