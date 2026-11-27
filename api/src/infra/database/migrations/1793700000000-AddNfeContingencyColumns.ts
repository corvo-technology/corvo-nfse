import type { MigrationInterface, QueryRunner } from 'typeorm';

const STATUSES = [
  'queued',
  'processing',
  'authorized',
  'rejected',
  'denied',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
  'cancelling',
  'cancelled',
  'discarded',
];

const list = (values: string[]): string =>
  values.map((value) => `'${value}'`).join(',');

/**
 * Off-line NFC-e (`tpEmis` 9): the `contingency_pending` state, the contingency moment and reason
 * (`dhCont`, `xJust`), the moment of the 20 h warning, and `transmitted_at` (when an attempt was
 * handed to the SEFAZ).
 *
 * `down` FAILS on purpose while a document is `contingency_pending` (the old check cannot hold it):
 * transmit or discard those first. Nothing is deleted here.
 */
export class AddNfeContingencyColumns1793700000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  private async replaceStatusCheck(
    runner: QueryRunner,
    statuses: string[],
  ): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfe_documents DROP CONSTRAINT ck_nfe_documents_status`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_documents ADD CONSTRAINT ck_nfe_documents_status CHECK (status IN (${list(statuses)}))`,
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await this.replaceStatusCheck(runner, [...STATUSES, 'contingency_pending']);
    await runner.query(`ALTER TABLE ${s}.nfe_documents
      ADD COLUMN contingency_at timestamptz NULL,
      ADD COLUMN contingency_reason varchar(256) NULL,
      ADD COLUMN contingency_alerted_at timestamptz NULL,
      ADD COLUMN transmitted_at timestamptz NULL`);
    await runner.query(
      `CREATE INDEX idx_nfe_documents_contingency ON ${s}.nfe_documents (contingency_at) WHERE status = 'contingency_pending'`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.idx_nfe_documents_contingency`);
    await runner.query(`ALTER TABLE ${s}.nfe_documents
      DROP COLUMN transmitted_at,
      DROP COLUMN contingency_alerted_at,
      DROP COLUMN contingency_reason,
      DROP COLUMN contingency_at`);
    await this.replaceStatusCheck(runner, STATUSES);
  }
}
