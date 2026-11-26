import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NF-e (model 55) documents. Own table, never `nfse_invoices`: the body, the states and the
 * operations differ. The number, `cNF`, key and signed XML stay NULL until the numbering step
 * writes them in one transaction (write-ahead).
 */
export class CreateNfeDocuments1793100000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      company_id uuid NOT NULL,
      environment varchar(10) NOT NULL,
      model smallint NOT NULL DEFAULT 55,
      series integer NULL,
      number integer NULL,
      access_key char(44) NULL,
      c_nf char(8) NULL,
      tp_emis smallint NOT NULL DEFAULT 1,
      issued_at timestamptz NULL,
      nat_op varchar(60) NOT NULL,
      id_dest smallint NOT NULL,
      ind_final smallint NOT NULL DEFAULT 1,
      ind_pres smallint NOT NULL DEFAULT 1,
      fin_nfe smallint NOT NULL DEFAULT 1,
      tp_imp smallint NOT NULL DEFAULT 1,
      status varchar(30) NOT NULL DEFAULT 'queued',
      c_stat varchar(10) NULL,
      x_motivo text NULL,
      protocol varchar(20) NULL,
      authorized_at timestamptz NULL,
      recipient jsonb NOT NULL,
      totals jsonb NOT NULL,
      payment jsonb NOT NULL,
      transport jsonb NOT NULL DEFAULT '{"modFrete":9}'::jsonb,
      additional_info text NULL,
      external_id varchar(255) NULL,
      idempotency_key varchar(255) NOT NULL,
      request_hash char(64) NOT NULL,
      signed_xml text NULL,
      prot_nfe_xml text NULL,
      attempt integer NOT NULL DEFAULT 0,
      authority varchar(10) NULL,
      last_error_code varchar(50) NULL,
      last_error_message text NULL,
      last_error_type varchar(15) NULL,
      next_check_at timestamptz NULL,
      reconcile_attempts integer NOT NULL DEFAULT 0,
      documents_ready_at timestamptz NULL,
      email_status varchar(10) NULL,
      email_sent_at timestamptz NULL,
      cancel_reason text NULL,
      cancel_requested_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_nfe_documents_id_tenant UNIQUE (id, tenant_id),
      CONSTRAINT fk_nfe_documents_tenant FOREIGN KEY (tenant_id) REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_nfe_documents_company FOREIGN KEY (company_id, tenant_id, environment) REFERENCES ${s}.nfse_companies(id, tenant_id, environment),
      CONSTRAINT ck_nfe_documents_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_nfe_documents_model CHECK (model = 55),
      CONSTRAINT ck_nfe_documents_status CHECK (status IN ('queued','processing','authorized','rejected','denied','retry_pending','reconciliation_required','manual_review','cancelling','cancelled','discarded')),
      CONSTRAINT ck_nfe_documents_number CHECK (number IS NULL OR number BETWEEN 1 AND 999999999),
      CONSTRAINT ck_nfe_documents_series CHECK (series IS NULL OR series BETWEEN 0 AND 999),
      CONSTRAINT ck_nfe_documents_numbered CHECK ((number IS NULL) = (series IS NULL)),
      CONSTRAINT ck_nfe_documents_error_type CHECK (last_error_type IS NULL OR last_error_type IN ('communication','validation','configuration'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_nfe_documents_idempotency ON ${s}.nfe_documents (tenant_id, environment, idempotency_key)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_nfe_documents_access_key ON ${s}.nfe_documents (environment, access_key) WHERE access_key IS NOT NULL`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_nfe_documents_number ON ${s}.nfe_documents (company_id, model, series, number) WHERE number IS NOT NULL`,
    );
    await runner.query(
      `CREATE INDEX idx_nfe_documents_tenant_created ON ${s}.nfe_documents (tenant_id, environment, created_at DESC, id DESC)`,
    );
    await runner.query(
      `CREATE INDEX idx_nfe_documents_company_status ON ${s}.nfe_documents (company_id, status)`,
    );
    await runner.query(
      `CREATE INDEX idx_nfe_documents_check ON ${s}.nfe_documents (next_check_at) WHERE status IN ('processing','reconciliation_required','retry_pending')`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_documents ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_documents FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_documents USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.nfe_documents`);
  }
}
