import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Records who created each API key, so removing a member can revoke their keys. */
export class AddApiKeyCreatedBy1792720000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.api_keys ADD COLUMN created_by_user_id uuid`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.api_keys DROP COLUMN created_by_user_id`,
    );
  }
}
