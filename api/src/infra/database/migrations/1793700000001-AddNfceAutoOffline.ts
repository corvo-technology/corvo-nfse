import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The company's opt-in to issue the NFC-e off-line by itself when the SEFAZ cannot be reached (off by default). */
export class AddNfceAutoOffline1793700000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.company_nfe_settings ADD COLUMN nfce_auto_offline boolean NOT NULL DEFAULT false`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.company_nfe_settings DROP COLUMN nfce_auto_offline`,
    );
  }
}
