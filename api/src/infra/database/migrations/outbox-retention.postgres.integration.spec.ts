import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runRetentionRule } from '@/infra/retention/data-retention';
import { outboxRetentionRules } from '@/modules/invoice/infra/typeorm-outbox-retention';
import { createTypeOrmOptions } from '../typeorm.options';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `outbox_ret_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-12-01T07:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** The outbox purge against a real Postgres, and the index migration up and down. */
describePostgres('outbox retention', () => {
  let db: DataSource;
  let tenant: string;

  const table = `"${schema}".outbox_messages`;
  const add = async (
    status: string,
    ageDays: number,
    opts: { env?: string; availableInDays?: number; aggregate?: string } = {},
  ): Promise<string> => {
    const id = randomUUID();
    const at = new Date(now.getTime() - ageDays * DAY);
    await db.query(
      `INSERT INTO ${table} (id, tenant_id, environment, type, aggregate_id, payload, dedupe_key, status, available_at, updated_at, completed_at)
       VALUES ($1,$2,$3,'invoice.emit',$4,'{}',$5,$6,$7,$8,$9)`,
      [
        id,
        tenant,
        opts.env ?? 'live',
        opts.aggregate ?? randomUUID(),
        `k:${id}`,
        status,
        new Date(now.getTime() + (opts.availableInDays ?? -ageDays) * DAY),
        at,
        status === 'completed' ? at : null,
      ],
    );
    return id;
  };
  const exists = async (id: string): Promise<boolean> =>
    (await db.query<unknown[]>(`SELECT 1 FROM ${table} WHERE id = $1`, [id]))
      .length > 0;
  const purge = (enabled: boolean) =>
    runAsSystem('data_retention', async () => {
      for (const rule of outboxRetentionRules(`"${schema}"`, now))
        await runRetentionRule(db, rule, enabled, () => undefined);
    });

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    tenant = randomUUID();
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('dry run deletes nothing; enabled deletes only what is old enough', async () => {
    const completed15 = await add('completed', 15);
    const completed13 = await add('completed', 13);
    const dead100 = await add('dead', 100);
    const dead60 = await add('dead', 60);
    const test4 = await add('completed', 4, { env: 'test' });
    const test2 = await add('completed', 2, { env: 'test' });
    const live4 = await add('completed', 4);
    const pendingOld = await add('pending', 400);
    const claimedOld = await add('claimed', 400);
    const future = await add('pending', 0, { availableInDays: 10 });

    await purge(false);
    for (const id of [
      completed15,
      completed13,
      dead100,
      dead60,
      test4,
      test2,
      live4,
      pendingOld,
      claimedOld,
      future,
    ])
      expect(await exists(id)).toBe(true);

    await purge(true);
    for (const id of [completed15, dead100, test4])
      expect(await exists(id)).toBe(false);
    for (const id of [
      completed13,
      dead60,
      test2,
      live4,
      pendingOld,
      claimedOld,
      future,
    ])
      expect(await exists(id)).toBe(true);
  });

  it('keeps a finished row while its aggregate still has a message in flight', async () => {
    const aggregate = randomUUID();
    const oldDone = await add('completed', 30, { aggregate });
    const inFlight = await add('pending', 0, { aggregate });
    await purge(true);
    expect(await exists(oldDone)).toBe(true);
    expect(await exists(inFlight)).toBe(true);
  });

  it('deletes in batches, more rows than one batch', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await add('completed', 20));
    const [rule] = outboxRetentionRules(`"${schema}"`, now);
    const out = await runAsSystem('data_retention', () =>
      runRetentionRule(db, rule, true, () => undefined, {
        batchSize: 10,
        maxBatches: 100,
      }),
    );
    expect(out.deleted).toBeGreaterThanOrEqual(25);
    for (const id of ids) expect(await exists(id)).toBe(false);
  });

  it('migration down drops the index and up creates it again', async () => {
    const index = async (): Promise<number> => {
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_outbox_finished_updated'`,
        [schema],
      );
      return rows.length;
    };
    expect(await index()).toBe(1);
    await db.undoLastMigration();
    expect(await index()).toBe(0);
    await db.runMigrations();
    expect(await index()).toBe(1);
  });
});
