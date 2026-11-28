import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '../typeorm.options';
import { AddFavoriteKindAndCustomerAddress1792991000000 } from './1792991000000-AddFavoriteKindAndCustomerAddress';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `fav_kind_${randomUUID().replaceAll('-', '')}`;

/** The favorite kind (service or product) and the NF-e recipient columns of the customers, both ways. */
describePostgres('favorite kind and customer address migration', () => {
  let db: DataSource;
  const migration = new AddFavoriteKindAndCustomerAddress1792991000000();

  const columns = async (table: string): Promise<string[]> => {
    const rows: Array<{ column_name: string }> = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return rows.map((r) => r.column_name);
  };
  const run = async (direction: 'up' | 'down') => {
    const runner = db.createQueryRunner();
    try {
      await migration[direction](runner);
    } finally {
      await runner.release();
    }
  };

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('up: favorites get a kind and the product fields, customers the NF-e recipient columns', async () => {
    expect(await columns('service_favorites')).toEqual(
      expect.arrayContaining(['kind', 'ncm', 'unit_price', 'csosn', 'code']),
    );
    expect(await columns('customers')).toEqual(
      expect.arrayContaining(['address', 'ind_ie_dest', 'state_registration']),
    );
  });

  it('down removes the products and the columns, and up again (also over an existing structure) works', async () => {
    const tenant = randomUUID();
    const company = randomUUID();
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    await db.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Company','11222333000181','test')`,
      [company, tenant],
    );
    await db.query(
      `INSERT INTO "${schema}".service_favorites (tenant_id,company_id,label,description,service_code) VALUES ($1,$2,'Servico','Consultoria','010101')`,
      [tenant, company],
    );
    await db.query(
      `INSERT INTO "${schema}".service_favorites (tenant_id,company_id,kind,label,description,ncm,unit_price) VALUES ($1,$2,'product','Camiseta','Camiseta','61091000',10)`,
      [tenant, company],
    );
    // A product needs an NCM and a price, a service a service code.
    await expect(
      db.query(
        `INSERT INTO "${schema}".service_favorites (tenant_id,company_id,kind,label,description) VALUES ($1,$2,'product','x','x')`,
        [tenant, company],
      ),
    ).rejects.toThrow(/ck_service_favorites_kind_fields/);
    await run('down');
    expect(await columns('service_favorites')).not.toContain('kind');
    expect(await columns('customers')).not.toContain('address');
    const [{ count }]: Array<{ count: string }> = await db.query(
      `SELECT count(*) FROM "${schema}".service_favorites`,
    );
    expect(Number(count)).toBe(1);
    await run('up');
    await run('up');
    expect(await columns('service_favorites')).toContain('kind');
    expect(await columns('customers')).toContain('state_registration');
  });
});
