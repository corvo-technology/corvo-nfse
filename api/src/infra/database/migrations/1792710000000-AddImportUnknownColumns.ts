import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Spreadsheet columns the importer did not recognize, so the screen can say they were ignored. */
export class AddImportUnknownColumns1792710000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.imports ADD COLUMN unknown_columns jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.imports DROP COLUMN unknown_columns`,
    );
  }
}
