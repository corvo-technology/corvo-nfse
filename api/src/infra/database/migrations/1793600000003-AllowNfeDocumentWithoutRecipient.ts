import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A NFC-e (model 65) may be sold to an unidentified consumer, so `recipient` can be null for it.
 * The NF-e (model 55) keeps requiring one.
 */
export class AllowNfeDocumentWithoutRecipient1793600000003 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents ALTER COLUMN recipient DROP NOT NULL`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents ADD CONSTRAINT ck_nfe_documents_recipient CHECK (model = 65 OR recipient IS NOT NULL)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents DROP CONSTRAINT ck_nfe_documents_recipient`,
    );
    // Fails while a NFC-e without a recipient exists: that data cannot be kept in the old shape.
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents ALTER COLUMN recipient SET NOT NULL`,
    );
  }
}
