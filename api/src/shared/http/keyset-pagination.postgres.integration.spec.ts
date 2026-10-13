import { randomUUID } from 'node:crypto';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { AddCursorPaginationIndexes1791730000000 } from '@/infra/database/migrations/1791730000000-AddCursorPaginationIndexes';
import { queryCursorPage, readKeysetCursor } from './keyset-pagination';
import { decodeCursor } from './pagination';

@Entity('cursor_fixture')
class CursorFixture {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') tenant!: string;
  @Column({ type: 'timestamptz', name: 'created_at' }) createdAt!: Date;
}
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Cursor integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `cursor_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('cursor queries and migration on PostgreSQL', () => {
  let db: DataSource;
  const tenant = randomUUID();
  const ids = Array.from(
    { length: 4 },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  beforeAll(async () => {
    const options = createTypeOrmOptions({
      url: url!,
      schema,
      ssl: false,
      logging: false,
    });
    db = new DataSource({
      ...options,
      entities: [...(options.entities as string[]), CursorFixture],
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(
      `CREATE TABLE "${schema}".cursor_fixture (id uuid PRIMARY KEY, tenant uuid NOT NULL, created_at timestamptz NOT NULL)`,
    );
    for (const [index, id] of ids.entries())
      await db.query(
        `INSERT INTO "${schema}".cursor_fixture VALUES ($1,$2,$3)`,
        [
          id,
          tenant,
          index === 0
            ? '2026-01-01T00:00:00.123456Z'
            : '2026-01-01T00:00:00.123457Z',
        ],
      );
    await db.query(`INSERT INTO "${schema}".cursor_fixture VALUES ($1,$2,$3)`, [
      randomUUID(),
      randomUUID(),
      '2027-01-01T00:00:00Z',
    ]);
  }, 60000);
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });
  function page(
    limit: number,
    cursor?: string,
    scope: unknown = ['fixture', tenant],
  ) {
    return queryCursorPage(
      db
        .getRepository(CursorFixture)
        .createQueryBuilder('row')
        .where('row.tenant = :tenant', { tenant }),
      { limit, cursor },
      scope,
      (row) => row,
    );
  }
  it('handles tied timestamps and microseconds without duplicates or omissions', async () => {
    const first = await page(2);
    expect(first.data.map((row) => row.id)).toEqual([ids[3], ids[2]]);
    expect(
      decodeCursor<{ sort: string }>(first.pagination.nextCursor!).sort,
    ).toBe('2026-01-01T00:00:00.123457Z');
    const second = await page(2, first.pagination.nextCursor!);
    expect(second.data.map((row) => row.id)).toEqual([ids[1], ids[0]]);
    expect(second.pagination).toEqual({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
  });
  it('rejects wrong scope, ordering payload types and malformed cursors', async () => {
    const first = await page(1);
    await expect(
      page(1, first.pagination.nextCursor!, ['other-tenant']),
    ).rejects.toThrow();
    expect(() => readKeysetCursor('invalid', ['fixture', tenant])).toThrow();
  });
  it('accepts limit 1000 and returns an empty final page', async () => {
    expect((await page(1000)).data).toHaveLength(4);
  });
  it('does not need the cursor row to remain in the database', async () => {
    const first = await page(2);
    await db.query(`DELETE FROM "${schema}".cursor_fixture WHERE id = $1`, [
      ids[2],
    ]);
    expect(
      (await page(2, first.pagination.nextCursor!)).data.map((row) => row.id),
    ).toEqual([ids[1], ids[0]]);
  });
  it('adds and reverses the cursor indexes in an isolated schema', async () => {
    const runner = db.createQueryRunner();
    const migration = new AddCursorPaginationIndexes1791730000000();
    try {
      const indexes: Array<{ indexname: string }> = await db.query(
        'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE $2',
        [schema, '%cursor'],
      );
      expect(indexes).toHaveLength(11);
      await migration.down(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });
});
