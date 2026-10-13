import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StripeMonthlyBilling1791720000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const s = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(`ALTER TABLE ${s}.tenant_billing
      ADD COLUMN stripe_customer_id varchar UNIQUE,
      ADD COLUMN stripe_subscription_id varchar UNIQUE,
      ADD COLUMN stripe_status varchar,
      ADD COLUMN paid_until timestamptz,
      ADD COLUMN pending_plan_slug varchar,
      ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false, ADD COLUMN checkout_state jsonb`);
    await runner.query(`CREATE TABLE ${s}.billing_usage_periods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id),
      plan_slug varchar NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
      included integer NOT NULL CHECK(included >= 0), unit_cents integer NOT NULL CHECK(unit_cents >= 0),
      authorized integer NOT NULL DEFAULT 0 CHECK(authorized >= 0), reserved integer NOT NULL DEFAULT 0 CHECK(reserved >= 0),
      reported integer NOT NULL DEFAULT 0 CHECK(reported >= 0),
      stripe_customer_id varchar, stripe_subscription_id varchar, meter_event_name varchar, pending_report jsonb,
      CONSTRAINT uq_billing_usage_period UNIQUE(tenant_id, plan_slug, period_start), CHECK(period_end > period_start))`);
    // Preserve fiscal/credit history; seed only this month's free usage, never bill legacy activity.
    await runner.query(`INSERT INTO ${s}.billing_usage_periods(tenant_id,plan_slug,period_start,period_end,included,unit_cents,authorized,reserved)
      SELECT t.id,'free',(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 month',p.monthly_credit_allowance,0,
        count(i.id) FILTER(WHERE i.status='authorized'),
        count(i.id) FILTER(WHERE i.status IN ('queued','processing','retry_pending','reconciliation_required','manual_review'))
      FROM ${s}.tenants t JOIN ${s}.plans p ON p.slug='free' AND (t.plan_id=p.id OR t.plan_id IS NULL)
      LEFT JOIN ${s}.nfse_invoices i ON i.tenant_id=t.id AND i.environment='live' AND i.created_at>=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      GROUP BY t.id,p.monthly_credit_allowance`);
    await runner.query(`UPDATE ${s}.credit_transactions tx SET period_id=p.id
      FROM ${s}.billing_usage_periods p WHERE tx.tenant_id=p.tenant_id AND tx.type='invoice_authorized'
      AND tx.reserved_invoice_id IS NOT NULL AND tx.created_at>=p.period_start`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const s = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `UPDATE ${s}.credit_transactions SET period_id=NULL WHERE period_id IN (SELECT id FROM ${s}.billing_usage_periods)`,
    );
    await runner.query(`DROP TABLE ${s}.billing_usage_periods`);
    await runner.query(`ALTER TABLE ${s}.tenant_billing DROP COLUMN stripe_customer_id, DROP COLUMN stripe_subscription_id,
      DROP COLUMN stripe_status, DROP COLUMN paid_until, DROP COLUMN pending_plan_slug, DROP COLUMN cancel_at_period_end, DROP COLUMN checkout_state`);
  }
}
