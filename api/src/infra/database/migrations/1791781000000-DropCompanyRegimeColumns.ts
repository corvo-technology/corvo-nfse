import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the legacy fiscal-regime columns from `nfse_companies`.
 *
 * The regime (`tax_regime`, `simple_national`, `special_regime`) now lives in
 * `company_fiscal_profiles` (created by 1791780000000, which already copied the
 * legacy data). This migration is a pure drop; `down` re-adds the columns and
 * back-fills them from the open fiscal profile on a best-effort basis.
 */
export class DropCompanyRegimeColumns1791781000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies DROP COLUMN IF EXISTS tax_regime`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies DROP COLUMN IF EXISTS simple_national`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies DROP COLUMN IF EXISTS special_regime`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies ADD COLUMN IF NOT EXISTS tax_regime varchar(30)`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies ADD COLUMN IF NOT EXISTS simple_national boolean NOT NULL DEFAULT false`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies ADD COLUMN IF NOT EXISTS special_regime varchar(50)`,
    );

    // Best-effort parity restore from the open fiscal profile. nfse_companies
    // and company_fiscal_profiles both enforce FORCE RLS, so run as system.
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(
      `UPDATE ${s}.nfse_companies c
         SET tax_regime = COALESCE(
               CASE p.tax_regime
                 WHEN 'SIMPLES_NACIONAL' THEN 'Simples Nacional'
                 WHEN 'LUCRO_PRESUMIDO'   THEN 'Lucro Presumido'
                 WHEN 'LUCRO_REAL'        THEN 'Lucro Real'
                 WHEN 'MEI'               THEN 'MEI'
                 WHEN 'OUTRO_REGIME'      THEN 'OUTRO_REGIME'
                 ELSE 'Simples Nacional'
               END, 'Simples Nacional'),
             simple_national = COALESCE(p.simple_national, false),
             special_regime  = p.special_tax_regime
       FROM ${s}.company_fiscal_profiles p
       WHERE p.company_id = c.id
         AND p.tenant_id = c.tenant_id
         AND p.valid_until IS NULL`,
    );
    await runner.query(
      `UPDATE ${s}.nfse_companies SET tax_regime = 'Simples Nacional' WHERE tax_regime IS NULL`,
    );
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);

    await runner.query(
      `ALTER TABLE ${s}.nfse_companies ALTER COLUMN tax_regime SET NOT NULL`,
    );
  }
}
