import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only audit trail of platform admin actions. Deliberately has no
 * foreign keys (the trail must outlive deleted users/tenants) and no RLS (it is
 * not tenant data; only the platform admin module reads or writes it).
 */
export class CreatePlatformAdminAuditEvents1792930000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      CREATE TABLE ${s}.platform_admin_audit_events (
        id uuid PRIMARY KEY,
        actor_user_id uuid NOT NULL,
        actor_email text NOT NULL,
        action varchar(40) NOT NULL,
        target_tenant_id uuid,
        target_user_id uuid,
        reason text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        success boolean NOT NULL,
        idempotency_key varchar(200),
        ip_hash varchar(64),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(
      `CREATE UNIQUE INDEX uq_platform_admin_audit_grant_key ON ${s}.platform_admin_audit_events (idempotency_key) WHERE action = 'credit_grant' AND success`,
    );
    await runner.query(
      `CREATE INDEX idx_platform_admin_audit_created ON ${s}.platform_admin_audit_events (created_at DESC, id DESC)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE IF EXISTS ${this.schema(runner)}.platform_admin_audit_events`,
    );
  }
}
