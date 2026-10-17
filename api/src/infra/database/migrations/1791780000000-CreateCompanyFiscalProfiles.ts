import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompanyFiscalProfiles1791780000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.company_fiscal_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      tax_regime varchar(20) NOT NULL,
      simple_national boolean NOT NULL DEFAULT false,
      special_tax_regime varchar(50),
      ibs_cbs_regular_option boolean NOT NULL DEFAULT false,
      ibs_cbs_regular_from date,
      valid_from date NOT NULL,
      valid_until date,
      source varchar(30) NOT NULL,
      review_status varchar(12) NOT NULL DEFAULT 'unreviewed',
      reviewed_by varchar(100),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_cfp_regime CHECK (tax_regime IN ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','OUTRO_REGIME','UNKNOWN')),
      CONSTRAINT ck_cfp_review CHECK (review_status IN ('unreviewed','approved','rejected')),
      CONSTRAINT ck_cfp_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_cfp_company_valid_from ON ${s}.company_fiscal_profiles (company_id, valid_from)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_cfp_company_open ON ${s}.company_fiscal_profiles (company_id) WHERE valid_until IS NULL`,
    );
    await runner.query(
      `CREATE INDEX idx_cfp_company_validity ON ${s}.company_fiscal_profiles (company_id, valid_from, valid_until)`,
    );
    await runner.query(
      `CREATE INDEX idx_cfp_tenant ON ${s}.company_fiscal_profiles (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_fiscal_profiles FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.company_fiscal_profiles USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );

    // One initial profile per existing company, effective since the company was created.
    // FORCE ROW LEVEL SECURITY also applies to the migration role, so the copy must
    // run with system context enabled; SET is transactional and is switched off right after.
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(`INSERT INTO ${s}.company_fiscal_profiles
      (tenant_id, company_id, tax_regime, simple_national, special_tax_regime, valid_from, source, review_status)
      SELECT tenant_id, id,
        CASE tax_regime WHEN 'MEI' THEN 'MEI' WHEN 'Simples Nacional' THEN 'SIMPLES_NACIONAL'
          WHEN 'Lucro Presumido' THEN 'LUCRO_PRESUMIDO' WHEN 'Lucro Real' THEN 'LUCRO_REAL' ELSE 'UNKNOWN' END,
        simple_national, NULLIF(special_regime, ''), created_at::date, 'company_legacy', 'unreviewed'
      FROM ${s}.nfse_companies`);
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.company_fiscal_profiles`,
    );
  }
}
