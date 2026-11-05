import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The seeder only inserts plans that are missing, so rows that already existed under a slug
 * of the new catalog kept an old allowance (e.g. `escala` with 6000), and older slugs such as
 * `dev` and `pro` stayed active. Align the four sellable plans and retire the strays.
 */
export class SyncPlanCatalogRows1792660000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      UPDATE ${s}.plans AS plan
      SET monthly_credit_allowance = catalog.allowance,
          credit_unit_price_cents = 99,
          daily_limit = NULL,
          max_active_companies = 999999,
          active = true,
          updated_at = now()
      FROM (VALUES
        ('solo', 100), ('equipe', 250), ('empresa', 600), ('escala', 1200)
      ) AS catalog(slug, allowance)
      WHERE plan.slug = catalog.slug
    `);
    await runner.query(`
      UPDATE ${s}.plans
      SET active = false, updated_at = now()
      WHERE slug NOT IN ('free', 'solo', 'equipe', 'empresa', 'escala')
    `);
    // Usage periods already opened for the corrected plans pick up the right allowance.
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(`
      UPDATE ${s}.billing_usage_periods AS period
      SET included = plan.monthly_credit_allowance
      FROM ${s}.plans AS plan
      WHERE period.plan_slug = plan.slug
        AND plan.slug IN ('solo', 'equipe', 'empresa', 'escala')
        AND period.period_end > now()
        AND period.authorized = 0 AND period.reserved = 0
    `);
    // Accounts that a Stripe sync pushed back onto a retired plan (or on the stray slugs) go to "no plan".
    await runner.query(`
      UPDATE ${s}.tenants
      SET plan_id = (SELECT id FROM ${s}.plans WHERE slug = 'free'),
          updated_at = now()
      WHERE plan_id IN (SELECT id FROM ${s}.plans WHERE active = false)
    `);
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);
  }

  // Not reversible: the previous (inconsistent) values are not kept.
  async down(): Promise<void> {}
}
