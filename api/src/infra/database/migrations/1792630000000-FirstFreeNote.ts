import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the one-time free note claims and gives every existing workspace its
 * first free note (once per normalized e-mail, mirroring normalizeEmailKey).
 */
export class FirstFreeNote1792630000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      CREATE TABLE IF NOT EXISTS ${s}.free_note_claims (
        email_key varchar(320) PRIMARY KEY,
        tenant_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`
      WITH keyed AS (
        SELECT tb.tenant_id,
          CASE WHEN split_part(lower(trim(tb.billing_email)), '@', 2)
                    IN ('gmail.com', 'googlemail.com')
               THEN replace(split_part(split_part(lower(trim(tb.billing_email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
               ELSE split_part(split_part(lower(trim(tb.billing_email)), '@', 1), '+', 1)
                    || '@' || split_part(lower(trim(tb.billing_email)), '@', 2)
          END AS email_key,
          t.created_at
        FROM ${s}.tenant_billing tb
        JOIN ${s}.tenants t ON t.id = tb.tenant_id
        WHERE tb.billing_email IS NOT NULL
      ), first_per_person AS (
        SELECT DISTINCT ON (email_key) email_key, tenant_id
        FROM keyed ORDER BY email_key, created_at, tenant_id
      ), claimed AS (
        INSERT INTO ${s}.free_note_claims (email_key, tenant_id)
        SELECT email_key, tenant_id FROM first_per_person
        ON CONFLICT (email_key) DO NOTHING
        RETURNING tenant_id
      )
      INSERT INTO ${s}.credit_transactions
        (tenant_id, amount, type, source, description, is_reservation, created_at)
      SELECT tenant_id, 1, 'bonus', 'bonus', 'Primeira nota grátis', false, now()
      FROM claimed
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      DELETE FROM ${s}.credit_transactions
      WHERE type = 'bonus' AND description = 'Primeira nota grátis'
    `);
    await runner.query(`DROP TABLE IF EXISTS ${s}.free_note_claims`);
  }
}
