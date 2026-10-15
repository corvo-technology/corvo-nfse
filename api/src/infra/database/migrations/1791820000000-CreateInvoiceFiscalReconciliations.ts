import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciliation of the immutable fiscal snapshot against the values the
 * Sefin consolidated in the authorized NFS-e. One row per invoice (UNIQUE) —
 * re-reconciliations are idempotent inserts, never updates.
 */
export class CreateInvoiceFiscalReconciliations1791820000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.invoice_fiscal_reconciliations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id uuid NOT NULL UNIQUE REFERENCES ${s}.nfse_invoices(id) ON DELETE CASCADE,
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL,
      local_values jsonb NOT NULL,
      authorized_values jsonb NOT NULL,
      differences jsonb NOT NULL,
      tolerance_absolute varchar(12) NOT NULL,
      rules_version varchar(20) NOT NULL,
      reconciled_at timestamptz NOT NULL,
      CONSTRAINT ck_ifr_status CHECK (status IN ('matched','within_tolerance','divergent'))
    )`);
    await runner.query(
      `CREATE INDEX idx_ifr_tenant_id ON ${s}.invoice_fiscal_reconciliations (tenant_id)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.invoice_fiscal_reconciliations ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.invoice_fiscal_reconciliations FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.invoice_fiscal_reconciliations USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `DROP TABLE IF EXISTS ${s}.invoice_fiscal_reconciliations`,
    );
  }
}
