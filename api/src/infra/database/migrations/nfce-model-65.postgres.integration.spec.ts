import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '../typeorm.options';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `nfce_pr1_${randomUUID().replaceAll('-', '')}`;

/** The three migrations of NFC-e 1/5 (tenant release, model 65, series), both ways. */
describePostgres('NFC-e model 65 migrations', () => {
  let db: DataSource;

  const columns = async (table: string): Promise<string[]> => {
    const rows: Array<{ column_name: string }> = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return rows.map((r) => r.column_name);
  };
  const sequence = (model: number) =>
    db.query(
      `INSERT INTO "${schema}".nfe_number_sequences (tenant_id, company_id, model, series, current_number)
       SELECT t.id, c.id, $1, 1, 0 FROM "${schema}".tenants t JOIN "${schema}".nfse_companies c ON c.tenant_id = t.id LIMIT 1`,
      [model],
    );

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    const tenant = randomUUID();
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    await db.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
      [randomUUID(), tenant],
    );
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('up: the tenant release, the NFC-e series and model 65 exist', async () => {
    expect(await columns('tenants')).toContain('nfce_enabled_at');
    expect(await columns('company_nfe_settings')).toContain(
      'nfce_default_series',
    );
    await expect(sequence(65)).resolves.toBeDefined();
    await expect(sequence(99)).rejects.toThrow(/ck_nfe_number_sequences_model/);
  });

  it('down fails while an NFC-e row exists, and works once it is gone; then up again', async () => {
    // Newest first: series, model 65 (this one refuses to go with a model 65 row), tenant release.
    await db.undoLastMigration();
    expect(await columns('company_nfe_settings')).not.toContain(
      'nfce_default_series',
    );
    await expect(db.undoLastMigration()).rejects.toThrow();
    await db.query(
      `DELETE FROM "${schema}".nfe_number_sequences WHERE model = 65`,
    );
    await db.undoLastMigration();
    await expect(sequence(65)).rejects.toThrow(/ck_nfe_number_sequences_model/);
    await db.undoLastMigration();
    expect(await columns('tenants')).not.toContain('nfce_enabled_at');

    await db.runMigrations();
    expect(await columns('tenants')).toContain('nfce_enabled_at');
    expect(await columns('company_nfe_settings')).toContain(
      'nfce_default_series',
    );
    await expect(sequence(65)).resolves.toBeDefined();
  });
});
