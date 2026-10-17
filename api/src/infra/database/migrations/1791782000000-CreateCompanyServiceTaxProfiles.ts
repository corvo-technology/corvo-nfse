import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompanyServiceTaxProfiles1791782000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.company_service_tax_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      name varchar(120) NOT NULL,
      service_code varchar(6) NOT NULL,
      municipal_service_code varchar(20),
      nbs_code varchar(9),
      cst varchar(3),
      class_code varchar(6),
      operation_indicator varchar(6),
      operation_nature varchar(15) NOT NULL DEFAULT 'SERVICE',
      regime_applicability text[] NOT NULL DEFAULT '{}',
      incidence_municipality_code varchar(7),
      iss_taxation varchar(10),
      iss_rate numeric(8,5),
      iss_withholding_default boolean NOT NULL DEFAULT false,
      withholding_policy varchar(15) NOT NULL DEFAULT 'UNKNOWN',
      withholding_rates jsonb NOT NULL DEFAULT '{}',
      effective_from date NOT NULL,
      effective_until date,
      classification_source varchar(30) NOT NULL,
      review_status varchar(12) NOT NULL DEFAULT 'unreviewed',
      catalog_version varchar(40),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_cstp_service_code CHECK (service_code ~ '^[0-9]{6}$'),
      CONSTRAINT ck_cstp_operation_nature CHECK (operation_nature IN ('SERVICE','GOODS','MIXED','PARTNER_SALON')),
      CONSTRAINT ck_cstp_iss_taxation CHECK (iss_taxation IS NULL OR iss_taxation IN ('NORMAL','FIXED','EXEMPT')),
      CONSTRAINT ck_cstp_withholding_policy CHECK (withholding_policy IN ('UNKNOWN','NONE_CONFIRMED','CONFIGURED')),
      CONSTRAINT ck_cstp_iss_rate CHECK (iss_rate IS NULL OR iss_rate BETWEEN 0 AND 100),
      CONSTRAINT ck_cstp_validity CHECK (effective_until IS NULL OR effective_until > effective_from),
      CONSTRAINT ck_cstp_review CHECK (review_status IN ('unreviewed','approved','rejected'))
    )`);
    await runner.query(
      `CREATE INDEX idx_cstp_company_service ON ${s}.company_service_tax_profiles (company_id, service_code, effective_from)`,
    );
    await runner.query(
      `CREATE INDEX idx_cstp_tenant ON ${s}.company_service_tax_profiles (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.company_service_tax_profiles ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_service_tax_profiles FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.company_service_tax_profiles USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.company_service_tax_profiles`,
    );
  }
}
