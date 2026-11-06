import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One purchase credit per (tenant, payment reference): provider webhooks may be redelivered.
 * Only rows from this release on are covered, so legacy duplicates cannot break the migration.
 */
export class CreditPaymentRefUnique1792620000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_payment_ref
      ON ${schema}.credit_transactions (tenant_id, stripe_session_id)
      WHERE stripe_session_id IS NOT NULL AND type = 'purchase'
        AND created_at >= TIMESTAMPTZ '2026-11-05 00:00:00+00'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`DROP INDEX IF EXISTS ${schema}.uq_credit_payment_ref`);
  }
}
