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

  /**
   * Rolling back restores the previous status constraint, which has no
   * 'cancelling'/'cancelled'. We deliberately do not map those invoices to
   * 'authorized': that would falsify their fiscal state (a cancelled NFS-e
   * would look valid). The rollback is refused until they are resolved.
   */
  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    const rows = (await runner.query(
      `SELECT count(*)::int AS total FROM ${schema}.nfse_invoices WHERE status IN ('cancelling','cancelled')`,
    )) as Array<{ total: number }>;
    const total = Number(rows[0]?.total ?? 0);
    if (total > 0) {
      throw new Error(
        `Cannot roll back AddInvoiceCancellation: ${total} invoice(s) are cancelling or cancelled. Rolling them back to authorized would falsify their fiscal state; resolve them first.`,
      );
    }
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
