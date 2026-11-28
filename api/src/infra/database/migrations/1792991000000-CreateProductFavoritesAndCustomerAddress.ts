import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Products a company sells often (to fill the NF-e and NFC-e items in one click) and the NF-e
 * recipient data kept on the saved customer (address, state registration, indIEDest).
 * Numbered before the NF-e migrations and written with IF [NOT] EXISTS, so the migrations that
 * the NF-e specs undo one by one are not affected.
 */
export class CreateProductFavoritesAndCustomerAddress1792991000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE IF NOT EXISTS ${s}.product_favorites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      description varchar(120) NOT NULL,
      code varchar(60) NOT NULL DEFAULT '',
      gtin varchar(14),
      ncm varchar(8) NOT NULL,
      cest varchar(7),
      cfop varchar(4),
      unit varchar(6) NOT NULL DEFAULT 'UN',
      unit_price numeric(15,4) NOT NULL,
      csosn varchar(3),
      origin smallint,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_product_favorites_ncm CHECK (ncm ~ '^[0-9]{8}$'),
      CONSTRAINT ck_product_favorites_price CHECK (unit_price >= 0)
    )`);
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_product_favorites_company ON ${s}.product_favorites (company_id, created_at)`,
    );
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_product_favorites_tenant ON ${s}.product_favorites (tenant_id)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_product_favorites_description ON ${s}.product_favorites (company_id, (lower(description)))`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.product_favorites ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.product_favorites FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON ${s}.product_favorites`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.product_favorites USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );

    await runner.query(
      `ALTER TABLE ${s}.customers ADD COLUMN IF NOT EXISTS state_registration varchar(20)`,
    );
    await runner.query(
      `ALTER TABLE ${s}.customers ADD COLUMN IF NOT EXISTS ind_ie_dest smallint`,
    );
    await runner.query(
      `ALTER TABLE ${s}.customers ADD COLUMN IF NOT EXISTS address jsonb`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.customers DROP COLUMN IF EXISTS address`,
    );
    await runner.query(
      `ALTER TABLE ${s}.customers DROP COLUMN IF EXISTS ind_ie_dest`,
    );
    await runner.query(
      `ALTER TABLE ${s}.customers DROP COLUMN IF EXISTS state_registration`,
    );
    await runner.query(`DROP TABLE IF EXISTS ${s}.product_favorites`);
  }
}
