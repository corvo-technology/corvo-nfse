import type { MigrationInterface, QueryRunner } from 'typeorm';

/** NF-e release per tenant (null = off). Turned on by SQL until the platform admin has a button. */
export class AddTenantNfeEnabledAt1793000000002 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.tenants ADD COLUMN nfe_enabled_at timestamptz NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.tenants DROP COLUMN nfe_enabled_at`,
    );
  }
}
