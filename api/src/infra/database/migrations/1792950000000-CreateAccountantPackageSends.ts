import type { MigrationInterface, QueryRunner } from 'typeorm';

/** History of the monthly package sent (or not sent) to each company's accountant. */
export class CreateAccountantPackageSends1792950000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.accountant_package_sends (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      month char(7) NOT NULL,
      recipient varchar(254) NOT NULL,
      invoice_count integer NOT NULL DEFAULT 0,
      total_cents bigint NOT NULL DEFAULT 0,
      status varchar(20) NOT NULL,
      trigger varchar(20) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_accountant_package_sends_month CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      CONSTRAINT ck_accountant_package_sends_status CHECK (status IN ('sent', 'skipped-empty', 'skipped-too-large', 'failed')),
      CONSTRAINT ck_accountant_package_sends_trigger CHECK (trigger IN ('scheduled', 'manual', 'mcp-or-api'))
    )`);
    await runner.query(
      `CREATE INDEX idx_accountant_package_sends_company ON ${s}.accountant_package_sends (company_id, created_at DESC)`,
    );
    await runner.query(
      `CREATE INDEX idx_accountant_package_sends_tenant ON ${s}.accountant_package_sends (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.accountant_package_sends ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.accountant_package_sends FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.accountant_package_sends USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.accountant_package_sends`,
    );
  }
}
