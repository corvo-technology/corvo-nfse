import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { DocumentCreditPriceOrmEntity } from './document-credit-price.orm-entity';
import { TypeormCreditPriceReader } from './typeorm-credit-price.reader';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  )
    throw new Error('Credit price tests require a local _test database');
}
const describePostgres = url ? describe : describe.skip;
const schema = `credit_price_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('TypeormCreditPriceReader with real PostgreSQL', () => {
  let db: DataSource;
  let reader: TypeormCreditPriceReader;

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    reader = new TypeormCreditPriceReader(
      db.getRepository(DocumentCreditPriceOrmEntity),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('seeds one credit for every document type', async () => {
    expect(await reader.priceOf('nfse')).toBe(1);
    expect(await reader.priceOf('nfe')).toBe(1);
    expect(await reader.priceOf('nfce')).toBe(1);
  });

  it('reads a changed price at once, without cache', async () => {
    await db.query(
      `UPDATE "${schema}".document_credit_prices SET credits = 3 WHERE document_type = 'nfe'`,
    );
    expect(await reader.priceOf('nfe')).toBe(3);
  });

  it('defaults a reservation to the nfse document type', async () => {
    const [column] = await db.query<{ column_default: string }[]>(
      `SELECT column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'credit_transactions' AND column_name = 'reserved_document_type'`,
      [schema],
    );
    expect(column.column_default).toContain('nfse');
  });
});
