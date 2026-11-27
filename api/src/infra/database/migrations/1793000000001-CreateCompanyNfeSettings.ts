import type { MigrationInterface, QueryRunner } from 'typeorm';

/** NF-e settings of a company (IE, CRT, series, Simples defaults), one row per company. */
export class CreateCompanyNfeSettings1793000000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    // Target of the tenant-safe composite foreign key below.
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies ADD CONSTRAINT uq_nfse_companies_id_tenant UNIQUE (id, tenant_id)`,
    );
    await runner.query(`CREATE TABLE ${s}.company_nfe_settings (
      company_id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      state_registration varchar(14) NULL,
      crt smallint NULL,
      default_series integer NOT NULL DEFAULT 1,
      default_nat_op varchar(60) NOT NULL DEFAULT 'Venda de mercadoria',
      default_csosn varchar(3) NOT NULL DEFAULT '102',
      default_origin smallint NOT NULL DEFAULT 0,
      default_pis_cst varchar(2) NOT NULL DEFAULT '49',
      default_cofins_cst varchar(2) NOT NULL DEFAULT '49',
      nfce_csc_id varchar(6) NULL,
      nfce_csc_encrypted text NULL,
      contingency_mode varchar(10) NOT NULL DEFAULT 'none',
      enabled_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_company_nfe_settings_tenant FOREIGN KEY (tenant_id) REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_company_nfe_settings_company FOREIGN KEY (company_id, tenant_id) REFERENCES ${s}.nfse_companies(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT ck_company_nfe_settings_crt CHECK (crt IN (1, 4)),
      CONSTRAINT ck_company_nfe_settings_series CHECK (default_series BETWEEN 0 AND 999),
      CONSTRAINT ck_company_nfe_settings_csosn CHECK (default_csosn IN ('102', '400')),
      CONSTRAINT ck_company_nfe_settings_origin CHECK (default_origin BETWEEN 0 AND 8),
      CONSTRAINT ck_company_nfe_settings_contingency CHECK (contingency_mode IN ('none'))
    )`);
    await runner.query(
      `CREATE INDEX idx_company_nfe_settings_tenant ON ${s}.company_nfe_settings (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.company_nfe_settings ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_nfe_settings FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.company_nfe_settings USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP TABLE ${s}.company_nfe_settings`);
    await runner.query(
      `ALTER TABLE ${s}.nfse_companies DROP CONSTRAINT uq_nfse_companies_id_tenant`,
    );
  }
}
