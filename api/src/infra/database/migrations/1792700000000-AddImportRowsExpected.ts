import type { MigrationInterface, QueryRunner } from 'typeorm';

/** How many rows the uploaded file has, set once it is parsed, so the screen can show reading progress. */
export class AddImportRowsExpected1792700000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.imports ADD COLUMN rows_expected integer`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.imports DROP COLUMN rows_expected`,
    );
  }
}
