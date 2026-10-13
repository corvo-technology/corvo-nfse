import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentsReadyAndEmailStateToInvoices1791575000000 implements MigrationInterface {
  name = 'AddDocumentsReadyAndEmailStateToInvoices1791575000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);

    await queryRunner.query(`
      ALTER TABLE ${schema}."nfse_invoices"
        ADD COLUMN documents_ready_at TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN last_email_status VARCHAR(10) NULL
          CONSTRAINT ck_nfse_invoices_last_email_status
          CHECK (last_email_status IN ('queued','sent','failed')),
        ADD COLUMN last_email_sent_at TIMESTAMP WITH TIME ZONE NULL
    `);

    await queryRunner.query(`
      CREATE INDEX idx_invoices_docs_pending
        ON ${schema}."nfse_invoices" (authorized_at)
        WHERE status = 'authorized' AND documents_ready_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);

    await queryRunner.query(`DROP INDEX ${schema}."idx_invoices_docs_pending"`);
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" DROP COLUMN documents_ready_at`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" DROP COLUMN last_email_status`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" DROP COLUMN last_email_sent_at`,
    );
  }

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const name = 'schema' in options ? (options.schema ?? 'corvo') : 'corvo';
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
      throw new Error('Invalid PostgreSQL schema name');
    }
    return queryRunner.connection.driver.escape(name);
  }
}
