import type { MigrationInterface, QueryRunner } from 'typeorm';

/** When the person last signed in (code, Google or GitHub). Null until their next login. */
export class AddAuthUserLastLoginAt1792920000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.auth_users
         ADD COLUMN last_login_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.auth_users
         DROP COLUMN last_login_at`,
    );
  }
}
