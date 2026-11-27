import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ledger of the lifecycle e-mails already sent to a workspace (first invoice, monthly summary,
 * pending payment). One row per workspace, kind and period: the unique key is what keeps a
 * second worker, a retry or a re-run from sending the same e-mail twice.
 */
export class CreateLifecycleEmailSends1792980000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.lifecycle_email_sends (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      kind varchar(30) NOT NULL,
      period varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_lifecycle_email_sends_kind CHECK (kind IN ('first-invoice', 'monthly-summary', 'payment-pending'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_lifecycle_email_sends_tenant_kind_period ON ${s}.lifecycle_email_sends (tenant_id, kind, period)`,
    );
    await runner.query(
      `CREATE INDEX idx_lifecycle_email_sends_tenant_created ON ${s}.lifecycle_email_sends (tenant_id, created_at)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.lifecycle_email_sends ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.lifecycle_email_sends FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.lifecycle_email_sends USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.lifecycle_email_sends`,
    );
  }
}
