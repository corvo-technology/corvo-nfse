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
const schema = `nfce_off_${randomUUID().replaceAll('-', '')}`;

/** The migrations of the off-line NFC-e: the `contingency_pending` state, its columns and the company option. */
describePostgres('off-line NFC-e migrations', () => {
  let db: DataSource;

  const columns = async (table: string): Promise<string[]> => {
    const rows: Array<{ column_name: string }> = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return rows.map((r) => r.column_name);
  };
  const insert = (status: string) =>
    db.query(
      `INSERT INTO "${schema}".nfe_documents (tenant_id,company_id,environment,model,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash,status,tp_emis)
       SELECT t.id, c.id, 'test', 65, 'Venda', 1, NULL, '{}', '{}', $1, repeat('a',64), $2, 9
       FROM "${schema}".tenants t JOIN "${schema}".nfse_companies c ON c.tenant_id = t.id LIMIT 1`,
      [randomUUID(), status],
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
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Company','11222333000181','test')`,
      [randomUUID(), tenant],
    );
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('up: accepts contingency_pending, has the columns, and the option exists', async () => {
    expect(await columns('nfe_documents')).toEqual(
      expect.arrayContaining([
        'contingency_at',
        'contingency_reason',
        'contingency_alerted_at',
        'transmitted_at',
      ]),
    );
    expect(await columns('company_nfe_settings')).toContain(
      'nfce_auto_offline',
    );
    await expect(insert('contingency_pending')).resolves.toBeDefined();
    await expect(insert('nonsense')).rejects.toThrow(/ck_nfe_documents_status/);
    await db.query(`DELETE FROM "${schema}".nfe_documents`);
  });

  it('down of the contingency columns fails while a contingency_pending row exists; then up again', async () => {
    await db.undoLastMigration();
    expect(await columns('company_nfe_settings')).not.toContain(
      'nfce_auto_offline',
    );
    await insert('contingency_pending');
    await expect(db.undoLastMigration()).rejects.toThrow();
    await db.query(`DELETE FROM "${schema}".nfe_documents`);
    await db.undoLastMigration();
    expect(await columns('nfe_documents')).not.toContain('contingency_at');
    await expect(insert('contingency_pending')).rejects.toThrow(
      /ck_nfe_documents_status/,
    );
    await db.runMigrations();
    await expect(insert('contingency_pending')).resolves.toBeDefined();
    await db.query(`DELETE FROM "${schema}".nfe_documents`);
  });
});
