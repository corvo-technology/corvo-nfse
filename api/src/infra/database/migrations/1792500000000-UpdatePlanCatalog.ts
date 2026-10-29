import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Aligns existing cloud tenants with the public monthly pricing catalog. */
export class UpdatePlanCatalog1792500000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`
      UPDATE ${schema}.plans AS plan
      SET
        name = catalog.name,
        description = catalog.description,
        monthly_credit_allowance = catalog.allowance,
        max_active_companies = catalog.max_companies,
        credit_unit_price_cents = catalog.overage,
        updated_at = now()
      FROM (VALUES
        ('free', 'Free', 'Perfect for testing and small projects', 15, 1, 0),
        ('developer', 'Developer', 'Para começar a emitir NFS-e em qualquer número de empresas', 250, 999999, 12),
        ('growth', 'Growth', 'Para operações em crescimento com empresas ilimitadas', 1500, 999999, 8),
        ('scale', 'Scale', 'Para operações de alto volume com empresas ilimitadas', 6000, 999999, 5),
        ('volume', 'Volume', 'Para o maior volume, com empresas ilimitadas', 20000, 999999, 5)
      ) AS catalog(slug, name, description, allowance, max_companies, overage)
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

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`
      UPDATE ${schema}.plans AS plan
      SET
        name = catalog.name,
        description = catalog.description,
        monthly_credit_allowance = catalog.allowance,
        max_active_companies = catalog.max_companies,
        credit_unit_price_cents = catalog.overage,
        updated_at = now()
      FROM (VALUES
        ('free', 'Free', 'Perfect for testing and small projects', 15, 1, 0),
        ('developer', 'Developer', 'Ideal for developers and small teams', 200, 10, 15),
        ('growth', 'Growth', 'For growing businesses with higher volume needs', 750, 50, 12),
        ('scale', 'Scale', 'Enterprise-grade for high-volume operations', 2500, 500, 10),
        ('volume', 'Volume', 'Maximum volume with best per-credit pricing', 10000, 999999, 9)
      ) AS catalog(slug, name, description, allowance, max_companies, overage)
      WHERE plan.slug = catalog.slug
    `);
  }
}
