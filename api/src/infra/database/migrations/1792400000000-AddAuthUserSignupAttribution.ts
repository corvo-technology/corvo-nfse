import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthUserSignupAttribution1792400000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.auth_users
         ADD COLUMN IF NOT EXISTS signup_attribution jsonb NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.auth_users DROP COLUMN IF EXISTS signup_attribution`,
    );
  }
}
