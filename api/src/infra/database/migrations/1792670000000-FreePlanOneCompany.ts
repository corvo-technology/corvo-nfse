import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "No plan" (avulso notes only) allows one active company in production; the four recurring
 * plans stay unlimited. Companies a workspace already has are not touched: only creating a new
 * one past the limit is refused.
 */
export class FreePlanOneCompany1792670000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `UPDATE ${s}.plans SET max_active_companies = 1, updated_at = now() WHERE slug = 'free'`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `UPDATE ${s}.plans SET max_active_companies = 999999, updated_at = now() WHERE slug = 'free'`,
    );
  }
}
