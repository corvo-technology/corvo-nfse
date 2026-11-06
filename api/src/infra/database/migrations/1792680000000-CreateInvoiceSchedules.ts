import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scheduled (once) and recurring invoices, and the log of every attempt to run them.
 * Both tables follow the tenant isolation policy of the other tenant-owned tables.
 */
export class CreateInvoiceSchedules1792680000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.invoice_schedules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NOT NULL,
      company_id uuid NOT NULL,
      kind varchar(10) NOT NULL,
      frequency varchar(10),
      anchor_on date NOT NULL,
      ends_on date,
      invoice_input jsonb NOT NULL,
      status varchar(10) NOT NULL DEFAULT 'active',
      pause_reason varchar(10),
      occurrence_index integer NOT NULL DEFAULT 0,
      next_run_on date,
      attempts integer NOT NULL DEFAULT 0,
      last_run_on date,
      created_by varchar(100),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_invoice_schedules_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_invoice_schedules_kind CHECK (kind IN ('once','recurring')),
      CONSTRAINT ck_invoice_schedules_frequency CHECK (frequency IS NULL OR frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')),
      CONSTRAINT ck_invoice_schedules_status CHECK (status IN ('active','paused','completed','cancelled')),
      CONSTRAINT ck_invoice_schedules_pause_reason CHECK (pause_reason IS NULL OR pause_reason IN ('customer','failures'))
    )`);
    await runner.query(
      `CREATE INDEX idx_invoice_schedules_due ON ${schema}.invoice_schedules (next_run_on) WHERE status = 'active'`,
    );
    await runner.query(
      `CREATE INDEX idx_invoice_schedules_tenant ON ${schema}.invoice_schedules (tenant_id, created_at DESC)`,
    );

    await runner.query(`CREATE TABLE ${schema}.invoice_schedule_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      schedule_id uuid NOT NULL REFERENCES ${schema}.invoice_schedules(id) ON DELETE CASCADE,
      occurrence_on date NOT NULL,
      ran_on date NOT NULL,
      attempt integer NOT NULL,
      outcome varchar(10) NOT NULL,
      invoice_id uuid,
      error_code varchar(100),
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_invoice_schedule_runs_outcome CHECK (outcome IN ('issued','failed'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_invoice_schedule_runs_attempt ON ${schema}.invoice_schedule_runs (schedule_id, occurrence_on, attempt)`,
    );
    await runner.query(
      `CREATE INDEX idx_invoice_schedule_runs_schedule ON ${schema}.invoice_schedule_runs (schedule_id, created_at DESC)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    for (const table of ['invoice_schedules', 'invoice_schedule_runs']) {
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
    await runner.query(`DROP TABLE ${schema}.invoice_schedule_runs`);
    await runner.query(`DROP TABLE ${schema}.invoice_schedules`);
  }
}
