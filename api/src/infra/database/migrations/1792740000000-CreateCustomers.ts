import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customers (tomadores) saved from accepted invoices, one row per document in each
 * workspace and environment. Follows the tenant isolation policy of the other tenant-owned tables.
 */
export class CreateCustomers1792740000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NOT NULL,
      tax_id varchar(14) NOT NULL,
      name varchar(300) NOT NULL,
      email varchar(255),
      last_used_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_customers_environment CHECK (environment IN ('test','live'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_customers_tax_id ON ${schema}.customers (tenant_id, environment, tax_id)`,
    );
    await runner.query(
      `CREATE INDEX idx_customers_recent ON ${schema}.customers (tenant_id, environment, last_used_at DESC)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${schema}.customers ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.customers FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${schema}.customers USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.customers`);
  }
}
