import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The favorites table also keeps products (to fill the NF-e and NFC-e items): a `kind` column
 * (`service` by default, so every row that exists stays a service) and the product fields, plus the
 * NF-e recipient columns of the customers (address, state registration, indIEDest).
 * Numbered before the NF-e migrations and written with IF [NOT] EXISTS, so the migrations that
 * the NF-e specs undo one by one are not affected.
 */
export class AddFavoriteKindAndCustomerAddress1792991000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    const fav = `${s}.service_favorites`;
    await runner.query(
      `ALTER TABLE ${fav} ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'service'`,
    );
    for (const column of [
      'code varchar(60)',
      'gtin varchar(14)',
      'ncm varchar(8)',
      'cest varchar(7)',
      'cfop varchar(4)',
      'unit varchar(6)',
      'unit_price numeric(15,4)',
      'csosn varchar(3)',
      'origin smallint',
    ])
      await runner.query(
        `ALTER TABLE ${fav} ADD COLUMN IF NOT EXISTS ${column}`,
      );
    await runner.query(
      `ALTER TABLE ${fav} ALTER COLUMN service_code DROP NOT NULL`,
    );
    for (const [name, rule] of [
      ['ck_service_favorites_kind', `kind IN ('service','product')`],
      [
        'ck_service_favorites_kind_fields',
        `(kind = 'service' AND service_code IS NOT NULL) OR (kind = 'product' AND ncm IS NOT NULL AND unit_price IS NOT NULL)`,
      ],
      ['ck_service_favorites_ncm', `ncm IS NULL OR ncm ~ '^[0-9]{8}$'`],
      [
        'ck_service_favorites_unit_price',
        `unit_price IS NULL OR unit_price >= 0`,
      ],
    ]) {
      await runner.query(
        `ALTER TABLE ${fav} DROP CONSTRAINT IF EXISTS ${name}`,
      );
      await runner.query(
        `ALTER TABLE ${fav} ADD CONSTRAINT ${name} CHECK (${rule})`,
      );
    }
    await runner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_service_favorites_product ON ${fav} (company_id, (lower(description))) WHERE kind = 'product'`,
    );

    const c = `${s}.customers`;
    await runner.query(
      `ALTER TABLE ${c} ADD COLUMN IF NOT EXISTS state_registration varchar(20)`,
    );
    await runner.query(
      `ALTER TABLE ${c} ADD COLUMN IF NOT EXISTS ind_ie_dest smallint`,
    );
    await runner.query(
      `ALTER TABLE ${c} ADD COLUMN IF NOT EXISTS address jsonb`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    const fav = `${s}.service_favorites`;
    const c = `${s}.customers`;
    await runner.query(`ALTER TABLE ${c} DROP COLUMN IF EXISTS address`);
    await runner.query(`ALTER TABLE ${c} DROP COLUMN IF EXISTS ind_ie_dest`);
    await runner.query(
      `ALTER TABLE ${c} DROP COLUMN IF EXISTS state_registration`,
    );
    await runner.query(
      `DROP INDEX IF EXISTS ${s}.uq_service_favorites_product`,
    );
    await runner.query(`DELETE FROM ${fav} WHERE kind = 'product'`);
    for (const name of [
      'ck_service_favorites_kind',
      'ck_service_favorites_kind_fields',
      'ck_service_favorites_ncm',
      'ck_service_favorites_unit_price',
    ])
      await runner.query(
        `ALTER TABLE ${fav} DROP CONSTRAINT IF EXISTS ${name}`,
      );
    for (const column of [
      'origin',
      'csosn',
      'unit_price',
      'unit',
      'cfop',
      'cest',
      'ncm',
      'gtin',
      'code',
      'kind',
    ])
      await runner.query(`ALTER TABLE ${fav} DROP COLUMN IF EXISTS ${column}`);
    await runner.query(
      `ALTER TABLE ${fav} ALTER COLUMN service_code SET NOT NULL`,
    );
  }
}
