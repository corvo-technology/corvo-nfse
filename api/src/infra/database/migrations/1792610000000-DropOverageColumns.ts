import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Overage billing is gone: drop the metering columns from billing_usage_periods. */
export class DropOverageColumns1792610000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const t = `${this.schema(runner)}.billing_usage_periods`;
    await runner.query(
      `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS billing_usage_periods_unit_cents_check`,
    );
    await runner.query(
      `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS billing_usage_periods_reported_check`,
    );
    await runner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS unit_cents`);
    await runner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS reported`);
    await runner.query(
      `ALTER TABLE ${t} DROP COLUMN IF EXISTS meter_event_name`,
    );
    await runner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS pending_report`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const t = `${this.schema(runner)}.billing_usage_periods`;
    await runner.query(
      `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS unit_cents integer NOT NULL DEFAULT 0`,
    );
    await runner.query(
      `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS reported integer NOT NULL DEFAULT 0`,
    );
    await runner.query(
      `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS meter_event_name varchar`,
    );
    await runner.query(
      `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS pending_report jsonb`,
    );
    await runner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT billing_usage_periods_unit_cents_check CHECK (unit_cents >= 0)`,
    );
    await runner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT billing_usage_periods_reported_check CHECK (reported >= 0)`,
    );
  }
}
