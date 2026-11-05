import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounts still on a retired plan (developer/growth/scale/volume) move to the
 * "no plan" placeholder (`free`), so billing endpoints never meet a plan with no price.
 * Their notes are unchanged: the first free note and any avulso balance still apply.
 */
export class MoveRetiredPlanTenants1792650000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    // FORCE ROW LEVEL SECURITY also binds the migration role: run as system.
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    await runner.query(`
      UPDATE ${s}.tenants
      SET plan_id = (SELECT id FROM ${s}.plans WHERE slug = 'free'),
          updated_at = now()
      WHERE plan_id IN (
        SELECT id FROM ${s}.plans
        WHERE slug IN ('developer', 'growth', 'scale', 'volume')
      )
    `);
    await runner.query(`SELECT set_config('app.system_context', 'off', false)`);
  }

  // Not reversible: the previous plan of each account is not kept.
  async down(): Promise<void> {}
}
