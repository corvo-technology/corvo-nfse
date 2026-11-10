import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A substitute NFS-e points at the invoice it replaces and keeps the reason sent in the DPS
 * (`subst/xMotivo`). Both are null for every ordinary invoice.
 */
export class AddInvoiceSubstitution1792750000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN substitutes_invoice_id uuid, ADD COLUMN substitution_description varchar(255)`,
    );
    await runner.query(
      `CREATE INDEX idx_nfse_invoices_substitutes ON ${schema}.nfse_invoices (tenant_id, substitutes_invoice_id) WHERE substitutes_invoice_id IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`DROP INDEX ${schema}.idx_nfse_invoices_substitutes`);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP COLUMN substitution_description, DROP COLUMN substitutes_invoice_id`,
    );
  }
}
