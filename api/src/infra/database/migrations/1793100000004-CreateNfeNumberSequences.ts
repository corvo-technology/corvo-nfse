import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Last number used per (company, model, series). The company already fixes the environment. */
export class CreateNfeNumberSequences1793100000004 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_number_sequences (
      tenant_id uuid NOT NULL,
      company_id uuid NOT NULL,
      model smallint NOT NULL,
      series integer NOT NULL,
      current_number integer NOT NULL DEFAULT 0,
      PRIMARY KEY (company_id, model, series),
      CONSTRAINT fk_nfe_number_sequences_company FOREIGN KEY (company_id, tenant_id) REFERENCES ${s}.nfse_companies(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT ck_nfe_number_sequences_model CHECK (model = 55),
      CONSTRAINT ck_nfe_number_sequences_series CHECK (series BETWEEN 0 AND 999),
      CONSTRAINT ck_nfe_number_sequences_number CHECK (current_number BETWEEN 0 AND 999999999)
    )`);
    await runner.query(
      `CREATE INDEX idx_nfe_number_sequences_tenant ON ${s}.nfe_number_sequences (tenant_id)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_number_sequences ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_number_sequences FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_number_sequences USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.nfe_number_sequences`,
    );
  }
}
