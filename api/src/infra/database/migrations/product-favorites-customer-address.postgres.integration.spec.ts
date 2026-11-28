import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '../typeorm.options';
import { CreateProductFavoritesAndCustomerAddress1792991000000 } from './1792991000000-CreateProductFavoritesAndCustomerAddress';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `prod_fav_${randomUUID().replaceAll('-', '')}`;

/** The product catalog table and the NF-e recipient columns of the customers, both ways. */
describePostgres('product favorites and customer address migration', () => {
  let db: DataSource;
  const migration = new CreateProductFavoritesAndCustomerAddress1792991000000();

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

  it('up: creates the products table with isolation on and the customer columns', async () => {
    expect(await columns('product_favorites')).toEqual(
      expect.arrayContaining(['description', 'ncm', 'unit_price', 'csosn']),
    );
    expect(await columns('customers')).toEqual(
      expect.arrayContaining(['address', 'ind_ie_dest', 'state_registration']),
    );
    const [{ relrowsecurity, relforcerowsecurity }]: Array<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }> = await db.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
      [`"${schema}".product_favorites`],
    );
    expect(relrowsecurity && relforcerowsecurity).toBe(true);
  });

  it('down removes both, and up again (also over an existing structure) works', async () => {
    await run('down');
    expect(await columns('product_favorites')).toEqual([]);
    expect(await columns('customers')).not.toContain('address');
    await run('up');
    await run('up');
    expect(await columns('product_favorites')).toContain('description');
    expect(await columns('customers')).toContain('state_registration');
  });
});
