import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credit reservations of NF-e. `reserved_invoice_id` has a foreign key to `nfse_invoices`, so an
 * NF-e cannot use it: it gets its own column, with the same deferred composite key and an
 * "one live reservation per document" index (a rejected NF-e is refunded and, when resubmitted,
 * reserves again). A reservation points to one document or to the other, never both.
 */
export class AddReservedNfeDocumentId1793200000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions ADD COLUMN reserved_nfe_document_id uuid NULL`,
    );
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions ADD CONSTRAINT fk_credit_nfe_document_tenant FOREIGN KEY (reserved_nfe_document_id, tenant_id) REFERENCES ${s}.nfe_documents (id, tenant_id) DEFERRABLE INITIALLY DEFERRED`,
    );
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions ADD CONSTRAINT ck_credit_single_document CHECK (reserved_invoice_id IS NULL OR reserved_nfe_document_id IS NULL)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX idx_credit_nfe_document_debit ON ${s}.credit_transactions (reserved_nfe_document_id) WHERE reserved_nfe_document_id IS NOT NULL AND is_reservation`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.idx_credit_nfe_document_debit`);
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions DROP CONSTRAINT ck_credit_single_document`,
    );
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions DROP CONSTRAINT fk_credit_nfe_document_tenant`,
    );
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions DROP COLUMN reserved_nfe_document_id`,
    );
  }
}
