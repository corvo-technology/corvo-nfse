import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Append-only trail of who did what in an account. Retention: 365 days (purged by the worker). */
export class CreateAccountAuditEvents1792960000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.account_audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor_type varchar(10) NOT NULL,
      actor_id text NULL,
      actor_label varchar(200) NOT NULL,
      actor_on_behalf_of_label varchar(200) NULL,
      action varchar(64) NOT NULL,
      target_type varchar(32) NULL,
      target_id text NULL,
      target_label varchar(200) NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip_hash varchar(64) NULL,
      CONSTRAINT ck_account_audit_events_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_account_audit_events_actor_type CHECK (actor_type IN ('user','agent','api_key','system')),
      CONSTRAINT ck_account_audit_events_metadata_size CHECK (pg_column_size(metadata) <= 4096)
    )`);
    await runner.query(
      `CREATE INDEX idx_account_audit_events_tenant_time ON ${s}.account_audit_events (tenant_id, occurred_at DESC, id DESC)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.account_audit_events ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.account_audit_events FORCE ROW LEVEL SECURITY`,
    );
    // No UPDATE policy: the trail is append-only (and purged by retention).
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.account_audit_events FOR SELECT USING (${owner} OR ${system})`,
    );
    await runner.query(
      `CREATE POLICY account_audit_insert_policy ON ${s}.account_audit_events FOR INSERT WITH CHECK (${owner} OR ${system})`,
    );
    await runner.query(
      `CREATE POLICY account_audit_delete_policy ON ${s}.account_audit_events FOR DELETE USING (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.account_audit_events`,
    );
  }
}
