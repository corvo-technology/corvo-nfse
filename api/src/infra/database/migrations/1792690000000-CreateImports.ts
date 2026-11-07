import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Spreadsheet imports and their rows. Both tables follow the tenant isolation policy of the other tenant-owned tables. */
export class CreateImports1792690000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NOT NULL,
      user_id varchar(100) NOT NULL,
      file_name varchar(255) NOT NULL,
      file_hash varchar(64) NOT NULL,
      status varchar(12) NOT NULL DEFAULT 'processing',
      company_id uuid,
      error_code varchar(100),
      emit_started_at timestamptz,
      emit_finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_imports_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_imports_status CHECK (status IN ('processing','ready','emitting','done','failed'))
    )`);
    await runner.query(
      `CREATE INDEX idx_imports_tenant ON ${schema}.imports (tenant_id, environment, created_at DESC)`,
    );
    await runner.query(
      `CREATE INDEX idx_imports_file_hash ON ${schema}.imports (tenant_id, environment, file_hash)`,
    );

    await runner.query(`CREATE TABLE ${schema}.import_rows (
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      import_id uuid NOT NULL REFERENCES ${schema}.imports(id) ON DELETE CASCADE,
      line integer NOT NULL,
      data jsonb NOT NULL,
      status varchar(10) NOT NULL,
      error_code varchar(100),
      error_message text,
      invoice_id uuid,
      PRIMARY KEY (import_id, line),
      CONSTRAINT ck_import_rows_status CHECK (status IN ('valid','invalid','queued','accepted','rejected'))
    )`);
    await runner.query(
      `CREATE INDEX idx_import_rows_status ON ${schema}.import_rows (import_id, status, line)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    for (const table of ['imports', 'import_rows']) {
      await runner.query(
        `ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`,
      );
      await runner.query(
        `ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`,
      );
      await runner.query(
        `CREATE POLICY tenant_isolation_policy ON ${schema}.${table} USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`DROP TABLE ${schema}.import_rows`);
    await runner.query(`DROP TABLE ${schema}.imports`);
  }
}
