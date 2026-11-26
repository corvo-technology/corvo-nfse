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
const schema = `nfe_pr4_${randomUUID().replaceAll('-', '')}`;

/** The two migrations of the emit + consult PR, both ways, on a real database. */
describePostgres('NF-e emit/consult migrations', () => {
  let db: DataSource;

  const columns = async (table: string): Promise<string[]> => {
    const rows: Array<{ column_name: string }> = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return rows.map((r) => r.column_name);
  };
  const indexes = async (table: string): Promise<string[]> => {
    const rows: Array<{ indexname: string }> = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
      [schema, table],
    );
    return rows.map((r) => r.indexname);
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

  it('up: the credit reservation points to an NF-e, and the webhook delivery to a document', async () => {
    expect(await columns('credit_transactions')).toContain(
      'reserved_nfe_document_id',
    );
    expect(await indexes('credit_transactions')).toContain(
      'idx_credit_nfe_document_debit',
    );
    expect(await columns('webhook_deliveries')).toContain('document_id');
    expect(await indexes('webhook_deliveries')).toContain(
      'idx_webhook_deliveries_document',
    );
  });

  it('a reservation cannot point to an invoice and an NF-e at once', async () => {
    const tenant = randomUUID();
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    await expect(
      db.query(
        `INSERT INTO "${schema}".credit_transactions (tenant_id, amount, type, reserved_invoice_id, reserved_nfe_document_id)
         VALUES ($1, -1, 'invoice_authorized', $2, $3)`,
        [tenant, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/ck_credit_single_document/);
  });

  it('down then up again: both changes undo and redo without leftovers', async () => {
    await db.undoLastMigration();
    await db.undoLastMigration();
    expect(await columns('webhook_deliveries')).not.toContain('document_id');
    expect(await indexes('webhook_deliveries')).not.toContain(
      'idx_webhook_deliveries_document',
    );
    expect(await columns('credit_transactions')).not.toContain(
      'reserved_nfe_document_id',
    );
    expect(await indexes('credit_transactions')).not.toContain(
      'idx_credit_nfe_document_debit',
    );
    await db.runMigrations();
    expect(await columns('credit_transactions')).toContain(
      'reserved_nfe_document_id',
    );
    expect(await columns('webhook_deliveries')).toContain('document_id');
  });
});
