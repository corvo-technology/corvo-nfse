import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The monthly package for the accountant: the e-mail to send it to (null = off) and the
 * last month already sent, which keeps a month from going out twice.
 */
export class AddAccountantPackage1792850000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies ADD COLUMN accountant_email varchar(254), ADD COLUMN accountant_package_last_sent_month char(7)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies DROP COLUMN accountant_package_last_sent_month, DROP COLUMN accountant_email`,
    );
  }
}
