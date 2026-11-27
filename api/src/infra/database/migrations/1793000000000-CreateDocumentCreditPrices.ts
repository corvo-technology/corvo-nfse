import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Credits charged per fiscal document type (global data, no RLS) and the type of each reservation. */
export class CreateDocumentCreditPrices1793000000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.document_credit_prices (
      document_type varchar(10) PRIMARY KEY,
      credits integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_document_credit_prices_type CHECK (document_type IN ('nfse','nfe','nfce')),
      CONSTRAINT ck_document_credit_prices_credits CHECK (credits > 0)
    )`);
    await runner.query(
      `INSERT INTO ${s}.document_credit_prices (document_type, credits) VALUES ('nfse', 1), ('nfe', 1), ('nfce', 1)`,
    );
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions ADD COLUMN reserved_document_type varchar(10) NOT NULL DEFAULT 'nfse'`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.credit_transactions DROP COLUMN reserved_document_type`,
    );
    await runner.query(`DROP TABLE ${s}.document_credit_prices`);
  }
}
