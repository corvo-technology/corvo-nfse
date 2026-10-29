import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiscalProfileSimplesApuracao1792500000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    // DPS regApTribSN of a ME/EPP: SN (1), ISS_MUNICIPAL (2) or REGULAR (3).
    // NULL means SN; only SN is supported for now.
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles
         ADD COLUMN IF NOT EXISTS simples_apuracao varchar(16)`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles
         ADD CONSTRAINT ck_cfp_simples_apuracao
         CHECK (simples_apuracao IS NULL OR simples_apuracao IN ('SN','ISS_MUNICIPAL','REGULAR'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles DROP CONSTRAINT IF EXISTS ck_cfp_simples_apuracao`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles DROP COLUMN IF EXISTS simples_apuracao`,
    );
  }
}
