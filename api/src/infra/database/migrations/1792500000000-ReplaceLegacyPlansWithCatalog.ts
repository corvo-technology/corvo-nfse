import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Legacy slug -> catalog slug that replaces it (volume has no equivalent; it folds into escala). */
const REPLACEMENTS = [
  ['developer', 'dev'],
  ['growth', 'pro'],
  ['scale', 'escala'],
  ['volume', 'escala'],
] as const;

type PlanValues = {
  name: string;
  description: string;
  allowance: number;
  maxCompanies: number;
  unitCents: number;
  rps: number;
  support: string;
};

const CATALOG: Record<string, PlanValues> = {
  dev: {
    name: 'Dev',
    description: 'Ideal for developers and small teams',
    allowance: 250,
    maxCompanies: 25,
    unitCents: 12,
    rps: 50,
    support: 'email',
  },
  pro: {
    name: 'Pro',
    description: 'For growing businesses with higher volume needs',
    allowance: 1500,
    maxCompanies: 150,
    unitCents: 8,
    rps: 150,
    support: 'email',
  },
  escala: {
    name: 'Escala',
    description: 'Enterprise-grade for high-volume operations',
    allowance: 6000,
    maxCompanies: 500,
    unitCents: 5,
    rps: 400,
    support: 'priority',
  },
};

/**
 * The legacy plans (developer, growth, scale, volume) were never sold to a paying
 * customer, so they are replaced by the catalog plans instead of being grandfathered.
 * A legacy row is renamed in place when its replacement does not exist yet (keeps its id
 * and every reference to it); otherwise its references move to the replacement and the
 * row is deleted. Stripe prices are resolved by lookup_key at runtime, so nothing changes
 * there. Not reversible: the legacy values are gone.
 */
export class ReplaceLegacyPlansWithCatalog1792500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const s = runner.connection.driver.escape(
      (runner.connection.options as { schema?: string }).schema ?? 'corvo',
    );
    // tenants, tenant_billing, billing_usage_periods and credit_transactions force RLS.
    await runner.query(`SELECT set_config('app.system_context', 'on', false)`);
    try {
      for (const [legacy, slug] of REPLACEMENTS) {
        const [old] = (await runner.query(
          `SELECT id FROM ${s}.plans WHERE slug = $1`,
          [legacy],
        )) as { id: string }[];
        if (!old) continue;
        const [target] = (await runner.query(
          `SELECT id FROM ${s}.plans WHERE slug = $1`,
          [slug],
        )) as { id: string }[];
        if (!target) {
          const v = CATALOG[slug];
          await runner.query(
            `UPDATE ${s}.plans SET slug = $2, name = $3, description = $4, monthly_credit_allowance = $5,
               daily_limit = NULL, max_active_companies = $6, credit_unit_price_cents = $7, throughput_rps = $8,
               support_tier = $9, active = true, updated_at = now() WHERE id = $1`,
            [
              old.id,
              slug,
              v.name,
              v.description,
              v.allowance,
              v.maxCompanies,
              v.unitCents,
              v.rps,
              v.support,
            ],
          );
        } else {
          await runner.query(
            `UPDATE ${s}.tenants SET plan_id = $2 WHERE plan_id = $1`,
            [old.id, target.id],
          );
          await runner.query(
            `UPDATE ${s}.tenant_billing SET downgrade_to_plan_id = $2 WHERE downgrade_to_plan_id = $1`,
            [old.id, target.id],
          );
          await runner.query(
            `UPDATE ${s}.credit_transactions SET plan_id_snapshot = $2 WHERE plan_id_snapshot = $1`,
            [old.id, target.id],
          );
          await runner.query(`DELETE FROM ${s}.plans WHERE id = $1`, [old.id]);
        }
        await runner.query(
          `UPDATE ${s}.tenant_billing SET pending_plan_slug = $2 WHERE pending_plan_slug = $1`,
          [legacy, slug],
        );
        await runner.query(
          `UPDATE ${s}.billing_usage_periods SET plan_slug = $2 WHERE plan_slug = $1`,
          [legacy, slug],
        );
      }
    } finally {
      await runner.query(
        `SELECT set_config('app.system_context', 'off', false)`,
      );
    }
  }

  down(): Promise<void> {
    return Promise.resolve();
  }
}
