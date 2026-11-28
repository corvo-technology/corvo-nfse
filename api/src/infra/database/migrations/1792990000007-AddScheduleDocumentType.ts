import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A schedule now issues an NFS-e or an NF-e. Old rows are NFS-e (the default). Numbered before the
 * NF-e migrations, like the other late additions, so their undo specs keep counting the same steps.
 */
export class AddScheduleDocumentType1792990000007 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.invoice_schedules ADD COLUMN IF NOT EXISTS document_type varchar(10) NOT NULL DEFAULT 'nfse'`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.invoice_schedules DROP CONSTRAINT IF EXISTS ck_invoice_schedules_document_type`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.invoice_schedules ADD CONSTRAINT ck_invoice_schedules_document_type CHECK (document_type IN ('nfse','nfe'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.invoice_schedules DROP CONSTRAINT IF EXISTS ck_invoice_schedules_document_type`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.invoice_schedules DROP COLUMN IF EXISTS document_type`,
    );
  }
}
