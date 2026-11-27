import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  ['nfe_documents', 'ck_nfe_documents_model'],
  ['nfe_number_sequences', 'ck_nfe_number_sequences_model'],
  ['nfe_inutilizations', 'ck_nfe_inutilizations_model'],
] as const;

/**
 * The NFC-e (model 65) lives in the same tables as the NF-e: the model checks accept 55 and 65.
 *
 * `down` puts `model = 55` back. It FAILS on purpose while any row with model 65 exists (the
 * constraint cannot be added over it): delete or move the NFC-e rows first. Nothing is deleted here.
 */
export class AllowNfceModel1793600000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  private async replace(
    runner: QueryRunner,
    expression: string,
  ): Promise<void> {
    const schema = this.schema(runner);
    for (const [table, constraint] of TABLES) {
      await runner.query(
        `ALTER TABLE ${schema}.${table} DROP CONSTRAINT ${constraint}`,
      );
      await runner.query(
        `ALTER TABLE ${schema}.${table} ADD CONSTRAINT ${constraint} CHECK (${expression})`,
      );
    }
  }

  async up(runner: QueryRunner): Promise<void> {
    await this.replace(runner, 'model IN (55, 65)');
  }

  async down(runner: QueryRunner): Promise<void> {
    await this.replace(runner, 'model = 55');
  }
}
