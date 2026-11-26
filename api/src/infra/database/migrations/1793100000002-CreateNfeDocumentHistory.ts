import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Every status transition of an NF-e, with the key and attempt it happened under. */
export class CreateNfeDocumentHistory1793100000002 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_document_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      document_id uuid NOT NULL,
      from_status varchar(30) NULL,
      to_status varchar(30) NOT NULL,
      access_key char(44) NULL,
      attempt integer NOT NULL DEFAULT 0,
      c_stat varchar(10) NULL,
      x_motivo text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_nfe_document_history_document FOREIGN KEY (document_id, tenant_id) REFERENCES ${s}.nfe_documents(id, tenant_id) ON DELETE CASCADE
    )`);
    await runner.query(
      `CREATE INDEX idx_nfe_document_history_document ON ${s}.nfe_document_history (document_id, created_at)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_history ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_history FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_document_history USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.nfe_document_history`,
    );
  }
}
