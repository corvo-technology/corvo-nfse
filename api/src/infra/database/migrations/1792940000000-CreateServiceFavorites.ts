import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Services a company bills often, saved to fill the new-invoice form in one click. */
export class CreateServiceFavorites1792940000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.service_favorites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      label varchar(80) NOT NULL,
      description text NOT NULL,
      service_code varchar(6) NOT NULL,
      amount_cents integer,
      municipality_code varchar(7),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_service_favorites_service_code CHECK (service_code ~ '^[0-9]{6}$'),
      CONSTRAINT ck_service_favorites_amount CHECK (amount_cents IS NULL OR amount_cents > 0)
    )`);
    await runner.query(
      `CREATE INDEX idx_service_favorites_company ON ${s}.service_favorites (company_id, created_at)`,
    );
    await runner.query(
      `CREATE INDEX idx_service_favorites_tenant ON ${s}.service_favorites (tenant_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.service_favorites ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.service_favorites FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.service_favorites USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.service_favorites`);
  }
}
