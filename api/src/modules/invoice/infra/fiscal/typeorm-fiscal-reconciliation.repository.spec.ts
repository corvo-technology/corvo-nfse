import { TypeOrmFiscalReconciliationRepository } from './typeorm-fiscal-reconciliation.repository';

const TABLES: Record<string, string> = {
  InvoiceOrmEntity: 'nfse_invoices',
  InvoiceFiscalSnapshotOrmEntity: 'invoice_fiscal_snapshots',
  InvoiceFiscalReconciliationOrmEntity: 'invoice_fiscal_reconciliations',
};

function subject() {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = {
    manager: { query },
    getMetadata: (entity: { name: string }) => ({
      schema: 'corvo',
      tableName: TABLES[entity.name],
    }),
    driver: { escape: (identifier: string) => `"${identifier}"` },
  };
  const repo = new TypeOrmFiscalReconciliationRepository(
    dataSource as never,
    { getManager: () => null } as never,
  );
  return { repo, query };
}

describe('findAuthorizedWithoutReconciliation', () => {
  it('qualifies every table with the application schema: the connection has no search_path', async () => {
    const { repo, query } = subject();

    await repo.findAuthorizedWithoutReconciliation(
      '11111111-1111-4111-8111-111111111111',
      new Date('2026-10-24T00:00:00Z'),
      10,
    );

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('FROM "corvo"."nfse_invoices" i');
    expect(sql).toContain('"corvo"."invoice_fiscal_snapshots" s');
    expect(sql).toContain('"corvo"."invoice_fiscal_reconciliations" r');
    // No table left to the connection's search_path.
    expect(sql).not.toMatch(/(FROM|JOIN)\s+(?!")[a-z_]+\s/i);
  });
});
