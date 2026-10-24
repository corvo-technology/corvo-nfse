import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmFiscalReconciliationRepository } from './typeorm-fiscal-reconciliation.repository';

describe('TypeOrmFiscalReconciliationRepository query', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // Real TypeORM metadata, no connection: the schema is resolved by TypeORM.
    dataSource = new DataSource({
      ...createTypeOrmOptions({
        url: 'postgresql://user:pass@localhost:5432/unused',
        schema: 'corvo',
        ssl: false,
        logging: false,
      }),
    });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
  });

  it('qualifies every table with the application schema: the connection has no search_path', () => {
    const repo = new TypeOrmFiscalReconciliationRepository(dataSource, {
      getManager: () => null,
    } as never);

    const [sql, parameters] = repo
      .authorizedWithoutReconciliation(
        '11111111-1111-4111-8111-111111111111',
        new Date('2026-10-24T00:00:00Z'),
        10,
      )
      .getQueryAndParameters();

    expect(sql).toContain('FROM "corvo"."nfse_invoices" "invoice"');
    expect(sql).toContain('FROM "corvo"."invoice_fiscal_snapshots" "snapshot"');
    expect(sql).toContain(
      'FROM "corvo"."invoice_fiscal_reconciliations" "reconciliation"',
    );
    // No table left to the connection's search_path.
    expect(sql).not.toMatch(/(FROM|JOIN)\s+(?!")[a-z_]+\s/i);
    expect(parameters).toContain('authorized');
  });
});
