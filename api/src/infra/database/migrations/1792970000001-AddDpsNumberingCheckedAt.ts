import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When the owner (or the automatic check) confirmed with the government that the DPS numbering of
 * a company does not repeat a number already used. Empty = not checked yet.
 */
export class AddDpsNumberingCheckedAt1792970000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_dps_sequences ADD COLUMN numbering_checked_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_dps_sequences DROP COLUMN numbering_checked_at`,
    );
  }
}
