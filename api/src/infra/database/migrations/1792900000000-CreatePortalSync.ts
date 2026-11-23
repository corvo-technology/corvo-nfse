import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reading of the national portal: one cursor per company and environment, every document the portal
 * handed out (one row per NSU), and what the events of issued invoices leave on the invoice itself
 * (a badge column and the origin of a timeline entry). Both new tables follow the tenant isolation
 * policy of the other tenant-owned tables.
 */
export class CreatePortalSync1792900000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.portal_sync_cursors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL,
      environment varchar(10) NOT NULL,
      last_nsu bigint NOT NULL DEFAULT 0,
      first_round_done_at timestamptz,
      last_run_at timestamptz,
      next_run_at timestamptz NOT NULL DEFAULT now(),
      idle_runs integer NOT NULL DEFAULT 0,
      failures integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_portal_sync_cursors_company FOREIGN KEY (company_id, tenant_id, environment) REFERENCES ${schema}.nfse_companies(id, tenant_id, environment) ON DELETE CASCADE,
      CONSTRAINT ck_portal_sync_cursors_environment CHECK (environment IN ('test','live'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_portal_sync_cursors_company ON ${schema}.portal_sync_cursors (company_id, environment)`,
    );
    await runner.query(
      `CREATE INDEX idx_portal_sync_cursors_tenant ON ${schema}.portal_sync_cursors (tenant_id)`,
    );

    await runner.query(`CREATE TABLE ${schema}.portal_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL,
      environment varchar(10) NOT NULL,
      nsu bigint NOT NULL,
      access_key varchar(60) NOT NULL,
      document_type varchar(40) NOT NULL,
      event_type varchar(80),
      xml text NOT NULL,
      generated_at timestamptz NOT NULL,
      processed_at timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_portal_documents_company FOREIGN KEY (company_id, tenant_id, environment) REFERENCES ${schema}.nfse_companies(id, tenant_id, environment) ON DELETE CASCADE,
      CONSTRAINT ck_portal_documents_environment CHECK (environment IN ('test','live'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_portal_documents_nsu ON ${schema}.portal_documents (company_id, environment, nsu)`,
    );
    await runner.query(
      `CREATE INDEX idx_portal_documents_access_key ON ${schema}.portal_documents (company_id, environment, access_key)`,
    );
    await runner.query(
      `CREATE INDEX idx_portal_documents_unprocessed ON ${schema}.portal_documents (company_id, environment, nsu) WHERE processed_at IS NULL`,
    );
    await runner.query(
      `CREATE INDEX idx_portal_documents_tenant ON ${schema}.portal_documents (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    for (const table of ['portal_sync_cursors', 'portal_documents']) {
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

    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN portal_flag varchar(20),
         ADD CONSTRAINT ck_nfse_invoices_portal_flag CHECK (portal_flag IN ('taker_rejected','blocked'))`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoice_events ADD COLUMN source varchar(10),
         ADD COLUMN portal_event varchar(80), ADD COLUMN portal_nsu bigint,
         ADD CONSTRAINT ck_nfse_invoice_events_source CHECK (source IN ('portal'))`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_nfse_invoice_events_portal_nsu ON ${schema}.nfse_invoice_events (invoice_id, portal_nsu) WHERE portal_nsu IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `DROP INDEX ${schema}.uq_nfse_invoice_events_portal_nsu`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoice_events DROP CONSTRAINT ck_nfse_invoice_events_source, DROP COLUMN portal_nsu, DROP COLUMN portal_event, DROP COLUMN source`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP CONSTRAINT ck_nfse_invoices_portal_flag, DROP COLUMN portal_flag`,
    );
    await runner.query(`DROP TABLE ${schema}.portal_documents`);
    await runner.query(`DROP TABLE ${schema}.portal_sync_cursors`);
  }
}
