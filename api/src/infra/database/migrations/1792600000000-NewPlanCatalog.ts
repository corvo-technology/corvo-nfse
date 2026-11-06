import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the catalog to Solo/Equipe/Empresa/Escala. The new rows are inserted by
 * PlanSeederService on boot; this migration retires the old paid plans and turns
 * `free` into the internal "no plan" placeholder (0 notes per month).
 */
export class NewPlanCatalog1792600000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`
      UPDATE ${schema}.plans
      SET active = false, updated_at = now()
      WHERE slug IN ('developer', 'growth', 'scale', 'volume')
    `);
    await runner.query(`
      UPDATE ${schema}.plans
      SET name = 'Sem plano',
          description = 'Sem plano ativo: primeira nota grátis e notas avulsas',
          monthly_credit_allowance = 0,
          daily_limit = NULL,
          max_active_companies = 999999,
          credit_unit_price_cents = 99,
          updated_at = now()
      WHERE slug = 'free'
    `);
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(`
      UPDATE ${schema}.billing_usage_periods
      SET included = 0
      WHERE plan_slug = 'free' AND period_end > now()
    `);
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`
      UPDATE ${schema}.plans
      SET active = true, updated_at = now()
      WHERE slug IN ('developer', 'growth', 'scale', 'volume')
    `);
    await runner.query(`
      UPDATE ${schema}.plans
      SET name = 'Free',
          description = 'Perfect for testing and small projects',
          monthly_credit_allowance = 15,
          daily_limit = 3,
          max_active_companies = 1,
          credit_unit_price_cents = 0,
          updated_at = now()
      WHERE slug = 'free'
    `);
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(`
      UPDATE ${schema}.billing_usage_periods
      SET included = 15
      WHERE plan_slug = 'free' AND period_end > now()
    `);
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);
  }
}
