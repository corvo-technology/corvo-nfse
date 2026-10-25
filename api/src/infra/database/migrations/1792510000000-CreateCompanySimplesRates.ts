import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompanySimplesRates1792510000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.company_simples_rates (
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      month char(7) NOT NULL,
      total_rate numeric(5,2) NOT NULL,
      iss_rate numeric(5,2),
      ibs_rate numeric(5,2),
      cbs_rate numeric(5,2),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, month),
      CONSTRAINT ck_csr_month CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      CONSTRAINT ck_csr_total_rate CHECK (total_rate BETWEEN 0 AND 100),
      CONSTRAINT ck_csr_iss_rate CHECK (iss_rate IS NULL OR iss_rate BETWEEN 0 AND 100),
      CONSTRAINT ck_csr_ibs_rate CHECK (ibs_rate IS NULL OR ibs_rate BETWEEN 0 AND 100),
      CONSTRAINT ck_csr_cbs_rate CHECK (cbs_rate IS NULL OR cbs_rate BETWEEN 0 AND 100)
    )`);
    await runner.query(
      `CREATE INDEX idx_csr_tenant ON ${s}.company_simples_rates (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.company_simples_rates ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.company_simples_rates FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.company_simples_rates USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE IF EXISTS ${this.schema(runner)}.company_simples_rates`,
    );
  }
}
