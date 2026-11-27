import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Requests to void a range of unused numbers (inutilização). */
export class CreateNfeInutilizations1793100000005 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_inutilizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      company_id uuid NOT NULL,
      environment varchar(10) NOT NULL,
      model smallint NOT NULL DEFAULT 55,
      series integer NOT NULL,
      start_number integer NOT NULL,
      end_number integer NOT NULL,
      justification text NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      protocol varchar(20) NULL,
      c_stat varchar(10) NULL,
      x_motivo text NULL,
      request_xml text NULL,
      proc_xml text NULL,
      xml_path text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_nfe_inutilizations_tenant FOREIGN KEY (tenant_id) REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_nfe_inutilizations_company FOREIGN KEY (company_id, tenant_id, environment) REFERENCES ${s}.nfse_companies(id, tenant_id, environment),
      CONSTRAINT ck_nfe_inutilizations_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_nfe_inutilizations_model CHECK (model = 55),
      CONSTRAINT ck_nfe_inutilizations_range CHECK (start_number <= end_number),
      CONSTRAINT ck_nfe_inutilizations_status CHECK (status IN ('pending','homologada','rejected'))
    )`);
    await runner.query(
      `CREATE INDEX idx_nfe_inutilizations_company ON ${s}.nfe_inutilizations (company_id, series, start_number)`,
    );
    await runner.query(
      `CREATE INDEX idx_nfe_inutilizations_tenant ON ${s}.nfe_inutilizations (tenant_id, created_at DESC)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_inutilizations ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_inutilizations FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_inutilizations USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.nfe_inutilizations`);
  }
}
