import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `POST /v1/nfe` accepts `sendEmail` (default true): whether the customer gets the NF-e by e-mail
 * once the documents are ready. The choice is kept on the document, since the e-mail is sent later.
 */
export class AddNfeSendEmail1793400000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfe_documents ADD COLUMN send_email boolean NOT NULL DEFAULT true`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfe_documents DROP COLUMN send_email`,
    );
  }
}
