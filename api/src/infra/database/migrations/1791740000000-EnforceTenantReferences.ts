import type { MigrationInterface, QueryRunner } from 'typeorm';

const references = [
  [
    'webhook_deliveries',
    'webhook_config_id',
    'webhook_configs',
    'fk_webhook_delivery_config_tenant',
    false,
  ],
  [
    'credit_transactions',
    'reserved_invoice_id',
    'nfse_invoices',
    'fk_credit_invoice_tenant',
    true,
  ],
  [
    'credit_transactions',
    'period_id',
    'billing_usage_periods',
    'fk_credit_period_tenant',
    false,
  ],
  [
    'credit_transactions',
    'related_transaction_id',
    'credit_transactions',
    'fk_credit_related_tenant',
    false,
  ],
] as const;
const parents = [
  'webhook_configs',
  'nfse_invoices',
  'billing_usage_periods',
  'credit_transactions',
] as const;

export class EnforceTenantReferences1791740000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      String(
        (runner.connection.options as { schema?: string }).schema ?? 'corvo',
      ),
    );
    for (const [child, column, parent] of references) {
      const rows = (await runner.query(
        `SELECT count(*)::text AS count FROM ${schema}."${child}" c LEFT JOIN ${schema}."${parent}" p ON p.id = c."${column}" AND p.tenant_id = c.tenant_id WHERE c."${column}" IS NOT NULL AND p.id IS NULL`,
      )) as Array<{ count: string }>;
      if (Number(rows[0].count))
        throw new Error(
          `Tenant integrity violation: ${child}.${column} has ${rows[0].count} invalid references; repair before migrating`,
        );
    }
    for (const table of parents)
      await runner.query(
        `ALTER TABLE ${schema}."${table}" ADD CONSTRAINT "uq_${table}_id_tenant" UNIQUE (id, tenant_id)`,
      );
    for (const [child, column, parent, name, deferred] of references)
      await runner.query(
        `ALTER TABLE ${schema}."${child}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}", tenant_id) REFERENCES ${schema}."${parent}" (id, tenant_id) ${deferred ? 'DEFERRABLE INITIALLY DEFERRED' : ''}`,
      );
    // A literal array also round-trips through TypeORM's PostgreSQL metadata reader.
    await runner.query(
      `ALTER TABLE ${schema}.auth_oauth_clients ALTER COLUMN grant_types SET DEFAULT '{authorization_code}'::text[]`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      String(
        (runner.connection.options as { schema?: string }).schema ?? 'corvo',
      ),
    );
    await runner.query(
      `ALTER TABLE ${schema}.auth_oauth_clients ALTER COLUMN grant_types SET DEFAULT ARRAY['authorization_code']`,
    );
    for (const [child, , , name] of [...references].reverse())
      await runner.query(
        `ALTER TABLE ${schema}."${child}" DROP CONSTRAINT "${name}"`,
      );
    for (const table of [...parents].reverse())
      await runner.query(
        `ALTER TABLE ${schema}."${table}" DROP CONSTRAINT "uq_${table}_id_tenant"`,
      );
  }
}
