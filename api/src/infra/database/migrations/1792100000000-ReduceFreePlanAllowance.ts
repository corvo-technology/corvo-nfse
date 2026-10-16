import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReduceFreePlanAllowance1792100000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `UPDATE ${schema}.plans SET monthly_credit_allowance = 15 WHERE slug = 'free'`,
    );
    // Preserve closed periods and consumption/reservations already recorded.
    await runner.query(
      `UPDATE ${schema}.billing_usage_periods SET included = 15 WHERE plan_slug = 'free' AND period_end > now()`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `UPDATE ${schema}.plans SET monthly_credit_allowance = 30 WHERE slug = 'free'`,
    );
    await runner.query(
      `UPDATE ${schema}.billing_usage_periods SET included = 30 WHERE plan_slug = 'free' AND period_end > now()`,
    );
  }
}
