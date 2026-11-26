import type { MigrationInterface, QueryRunner } from 'typeorm';

/** NFC-e release per tenant (null = off). Also needs the global NFE_ENABLED. */
export class AddTenantNfceEnabledAt1793600000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.tenants ADD COLUMN nfce_enabled_at timestamptz NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.tenants DROP COLUMN nfce_enabled_at`,
    );
  }
}
