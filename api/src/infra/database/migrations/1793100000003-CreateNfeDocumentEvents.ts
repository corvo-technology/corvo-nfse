import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Fiscal events of an NF-e: cancellation (110111) and correction letters (110110). */
export class CreateNfeDocumentEvents1793100000003 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_document_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      document_id uuid NOT NULL,
      tp_evento varchar(6) NOT NULL,
      n_seq smallint NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      protocol varchar(20) NULL,
      text text NULL,
      request_xml text NULL,
      proc_xml text NULL,
      xml_path text NULL,
      c_stat varchar(10) NULL,
      x_motivo text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_nfe_document_events_sequence UNIQUE (document_id, tp_evento, n_seq),
      CONSTRAINT fk_nfe_document_events_document FOREIGN KEY (document_id, tenant_id) REFERENCES ${s}.nfe_documents(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT ck_nfe_document_events_status CHECK (status IN ('pending','pending_check','registered','rejected'))
    )`);
    await runner.query(
      `CREATE INDEX idx_nfe_document_events_tenant ON ${s}.nfe_document_events (tenant_id)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_events ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_events FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_document_events USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.nfe_document_events`);
  }
}
