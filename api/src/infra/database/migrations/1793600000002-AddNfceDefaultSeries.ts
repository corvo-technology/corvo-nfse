import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The series of the NFC-e (model 65) of a company, apart from the NF-e one. */
export class AddNfceDefaultSeries1793600000002 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.company_nfe_settings ADD COLUMN nfce_default_series smallint NOT NULL DEFAULT 1`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.company_nfe_settings ADD CONSTRAINT ck_company_nfe_settings_nfce_series CHECK (nfce_default_series BETWEEN 0 AND 999)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.company_nfe_settings DROP CONSTRAINT ck_company_nfe_settings_nfce_series`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.company_nfe_settings DROP COLUMN nfce_default_series`,
    );
  }
}
