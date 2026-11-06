import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentIntents1792640000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`
      CREATE TABLE ${s}.payment_intents (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
        kind varchar(10) NOT NULL,
        plan_slug varchar,
        cycle varchar(10),
        units integer,
        amount_cents integer NOT NULL CHECK (amount_cents > 0),
        provider varchar(10) NOT NULL,
        provider_ref varchar(100) NOT NULL,
        idempotency_key varchar(200),
        status varchar(12) NOT NULL,
        expires_at timestamptz,
        paid_at timestamptz,
        checkout jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(
      `CREATE UNIQUE INDEX uq_payment_intents_provider_ref ON ${s}.payment_intents (provider, provider_ref)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_payment_intents_tenant_key ON ${s}.payment_intents (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE IF EXISTS ${this.schema(runner)}.payment_intents`,
    );
  }
}
