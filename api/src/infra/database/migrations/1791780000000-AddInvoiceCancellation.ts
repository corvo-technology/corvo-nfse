import type { MigrationInterface, QueryRunner } from 'typeorm';

const PREVIOUS_STATUSES = `'queued', 'processing', 'authorized', 'rejected', 'retry_pending', 'reconciliation_required', 'manual_review', 'failed'`;
const STATUSES = `${PREVIOUS_STATUSES}, 'cancelling', 'cancelled'`;

export class AddInvoiceCancellation1791780000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP CONSTRAINT ck_nfse_invoices_status`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD CONSTRAINT ck_nfse_invoices_status CHECK ("status" IN (${STATUSES}))`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices
         ADD COLUMN cancellation_reason varchar(30),
         ADD COLUMN cancellation_description text,
         ADD COLUMN cancelled_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices
         DROP COLUMN cancelled_at,
         DROP COLUMN cancellation_description,
         DROP COLUMN cancellation_reason`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP CONSTRAINT ck_nfse_invoices_status`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD CONSTRAINT ck_nfse_invoices_status CHECK ("status" IN (${PREVIOUS_STATUSES}))`,
    );
  }
}
