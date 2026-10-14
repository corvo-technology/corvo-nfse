import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxMessages1791770000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.outbox_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NOT NULL,
      type varchar(60) NOT NULL,
      aggregate_id uuid NOT NULL,
      payload jsonb NOT NULL,
      dedupe_key varchar(200) NOT NULL,
      status varchar(10) NOT NULL DEFAULT 'pending',
      available_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT ck_outbox_messages_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_outbox_messages_status CHECK (status IN ('pending','claimed','completed','dead'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_outbox_tenant_dedupe ON ${schema}.outbox_messages (tenant_id, dedupe_key)`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_pending_available ON ${schema}.outbox_messages (available_at) WHERE status = 'pending'`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_claimed_lease ON ${schema}.outbox_messages (lease_until) WHERE status = 'claimed'`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_tenant_aggregate ON ${schema}.outbox_messages (tenant_id, aggregate_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${schema}.outbox_messages ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.outbox_messages FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${schema}.outbox_messages USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );

    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN scheduled_for timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP COLUMN scheduled_for`,
    );
    await runner.query(`DROP TABLE ${schema}.outbox_messages`);
  }
}
