import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Rebalances included notes and overage per plan; monthly prices are unchanged. */
export class RebalancePlanAllowances1792530000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  private async apply(
    runner: QueryRunner,
    rows: ReadonlyArray<readonly [string, number, number]>,
  ): Promise<void> {
    const schema = this.schema(runner);
    const values = rows
      .map(
        ([slug, allowance, overage]) => `('${slug}', ${allowance}, ${overage})`,
      )
      .join(', ');
    await runner.query(`
      UPDATE ${schema}.plans AS plan
      SET
        monthly_credit_allowance = catalog.allowance,
        credit_unit_price_cents = catalog.overage,
        updated_at = now()
      FROM (VALUES ${values}) AS catalog(slug, allowance, overage)
      WHERE plan.slug = catalog.slug
    `);
    await runner.query(`
      UPDATE ${schema}.billing_usage_periods AS period
      SET included = plan.monthly_credit_allowance
      FROM ${schema}.plans AS plan
      WHERE period.plan_slug = plan.slug
        AND period.period_end > now()
    `);
  }

  async up(runner: QueryRunner): Promise<void> {
    await this.apply(runner, [
      ['developer', 200, 18],
      ['growth', 850, 14],
      ['scale', 3000, 12],
      ['volume', 10000, 9],
    ]);
  }

  async down(runner: QueryRunner): Promise<void> {
    await this.apply(runner, [
      ['developer', 250, 12],
      ['growth', 1500, 8],
      ['scale', 6000, 5],
      ['volume', 20000, 5],
    ]);
  }
}
