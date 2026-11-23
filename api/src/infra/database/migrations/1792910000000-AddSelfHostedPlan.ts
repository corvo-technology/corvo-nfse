import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The single plan of a self-hosted instance (`DEPLOYMENT_MODE=self_hosted`). It exists so a
 * tenant has a plan to link to and show; limits come from the unlimited quota, not from these
 * columns. Cloud never assigns it: `PlanController` lists the static catalogue, not this table.
 */
export class AddSelfHostedPlan1792910000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      INSERT INTO ${s}.plans (
        id, slug, name, description, monthly_credit_allowance, daily_limit, max_active_companies,
        credit_unit_price_cents, throughput_rps, includes_webhooks, includes_xml_download,
        includes_pdf_download, includes_api_keys, support_tier, active
      )
      VALUES (
        gen_random_uuid(), 'self-hosted', 'Self-hosted',
        'Instância própria: sem limites e sem cobrança', 0, NULL, 999999,
        0, 500, true, true, true, true, 'community', true
      )
      ON CONFLICT (slug) DO NOTHING
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `DELETE FROM ${s}.plans WHERE slug = 'self-hosted'
         AND NOT EXISTS (SELECT 1 FROM ${s}.tenants WHERE plan_id = plans.id)`,
    );
  }
}
