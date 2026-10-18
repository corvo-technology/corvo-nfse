import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiscalProfileSimplesIssRate1792400000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    // Effective ISS rate (%) of the Simples Nacional bracket of the previous
    // month (LC 123/2006, art. 21, §4º, I); required to withhold ISS for ME/EPP.
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles
         ADD COLUMN IF NOT EXISTS simples_iss_rate numeric(5,2)`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles
         ADD CONSTRAINT ck_cfp_simples_iss_rate
         CHECK (simples_iss_rate IS NULL OR simples_iss_rate BETWEEN 1.80 AND 5.00)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles DROP CONSTRAINT IF EXISTS ck_cfp_simples_iss_rate`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles DROP COLUMN IF EXISTS simples_iss_rate`,
    );
  }
}
