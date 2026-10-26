import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Simples Nacional rates are now two columns of the company (informed when
 * it is registered) instead of a table of monthly rates.
 */
export class MoveSimplesRatesToCompany1792520000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies
         ADD COLUMN IF NOT EXISTS simples_rate numeric(5,2),
         ADD COLUMN IF NOT EXISTS simples_iss_rate numeric(5,2),
         ADD CONSTRAINT ck_companies_simples_rate CHECK (simples_rate IS NULL OR simples_rate BETWEEN 0 AND 100),
         ADD CONSTRAINT ck_companies_simples_iss_rate CHECK (simples_iss_rate IS NULL OR simples_iss_rate BETWEEN 0 AND 100)`,
    );
    await runner.query(`DROP TABLE IF EXISTS ${s}.company_simples_rates`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies
         DROP CONSTRAINT IF EXISTS ck_companies_simples_iss_rate,
         DROP CONSTRAINT IF EXISTS ck_companies_simples_rate,
         DROP COLUMN IF EXISTS simples_iss_rate,
         DROP COLUMN IF EXISTS simples_rate`,
    );
  }
}
