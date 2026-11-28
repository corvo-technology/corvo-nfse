import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '../typeorm.options';
import { AddScheduleDocumentType1792990000007 } from './1792990000007-AddScheduleDocumentType';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `sched_doc_${randomUUID().replaceAll('-', '')}`;

/** The schedule's document type, both ways. It sits before the NF-e migrations, so it is run by hand. */
describePostgres('schedule document type migration', () => {
  let db: DataSource;
  const migration = new AddScheduleDocumentType1792990000007();

  const hasColumn = async (): Promise<boolean> => {
    const rows: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'invoice_schedules' AND column_name = 'document_type'`,
      [schema],
    );
    return rows.length > 0;
  };
  const insert = (documentType?: string) =>
    db.query(
      `INSERT INTO "${schema}".invoice_schedules (tenant_id, environment, company_id, kind, anchor_on, invoice_input${documentType ? ', document_type' : ''})
       SELECT t.id, 'test', gen_random_uuid(), 'once', '2026-12-01', '{}'::jsonb${documentType ? `, '${documentType}'` : ''}
       FROM "${schema}".tenants t LIMIT 1`,
    );

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      randomUUID(),
    ]);
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('up: existing and new rows are NFS-e by default; only nfse and nfe are accepted', async () => {
    expect(await hasColumn()).toBe(true);
    await insert();
    await insert('nfe');
    const rows: Array<{ document_type: string }> = await db.query(
      `SELECT document_type FROM "${schema}".invoice_schedules ORDER BY document_type`,
    );
    expect(rows.map((r) => r.document_type)).toEqual(['nfe', 'nfse']);
    await expect(insert('nfce')).rejects.toThrow(
      /ck_invoice_schedules_document_type/,
    );
  });

  it('down drops the column; up again restores it and is safe to repeat', async () => {
    const runner = db.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await hasColumn()).toBe(false);
      await migration.up(runner);
      await migration.up(runner);
      expect(await hasColumn()).toBe(true);
    } finally {
      await runner.release();
    }
  });
});
