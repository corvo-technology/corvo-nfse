import type { QueryRunner } from 'typeorm';
import { AddInvoiceCancellation1791780000000 } from './1791780000000-AddInvoiceCancellation';

function fakeRunner(total: number) {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return /SELECT count\(\*\)/i.test(sql) ? [{ total }] : undefined;
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('AddInvoiceCancellation', () => {
  it('up widens the status constraint and adds the cancellation columns', async () => {
    const { runner, queries } = fakeRunner(0);
    await new AddInvoiceCancellation1791780000000().up(runner);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toMatch(/DROP CONSTRAINT ck_nfse_invoices_status/);
    expect(queries[1]).toMatch(
      /ADD CONSTRAINT ck_nfse_invoices_status[\s\S]*'cancelling', 'cancelled'/,
    );
    expect(queries[2]).toMatch(
      /ADD COLUMN cancellation_reason[\s\S]*cancellation_description[\s\S]*cancelled_at/,
    );
  });

  it('down refuses to run while cancelling or cancelled invoices exist', async () => {
    const { runner, queries } = fakeRunner(3);
    const result = new AddInvoiceCancellation1791780000000().down(runner);
    await expect(result).rejects.toThrow(
      /3 invoice\(s\).*cancelling.*cancelled/,
    );
    expect(queries.some((sql) => /ALTER TABLE/i.test(sql))).toBe(false);
  });

  it('down runs the three rollback steps in order when nothing is cancelling or cancelled', async () => {
    const { runner, queries } = fakeRunner(0);
    await new AddInvoiceCancellation1791780000000().down(runner);
    const alters = queries.filter((sql) => /ALTER TABLE/i.test(sql));
    expect(alters).toHaveLength(3);
    expect(alters[0]).toMatch(
      /DROP COLUMN cancelled_at[\s\S]*DROP COLUMN cancellation_reason/,
    );
    expect(alters[1]).toMatch(/DROP CONSTRAINT ck_nfse_invoices_status/);
    expect(alters[2]).toMatch(/ADD CONSTRAINT ck_nfse_invoices_status/);
    expect(alters[2]).not.toMatch(/cancelling|cancelled/);
  });
});
