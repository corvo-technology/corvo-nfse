import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import {
  PlatformAdminAuditRepository,
  type PlatformAuditInput,
} from './platform-admin-audit.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Audit integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `audit_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('PlatformAdminAuditRepository on PostgreSQL', () => {
  let db: DataSource;
  let txContext: TypeOrmTransactionContext;
  let repo: PlatformAdminAuditRepository;

  const base = (
    over: Partial<PlatformAuditInput> = {},
  ): PlatformAuditInput => ({
    actorUserId: randomUUID(),
    actorEmail: 'admin@corvo.tech',
    action: 'credit_grant',
    targetTenantId: randomUUID(),
    reason: 'cortesia de teste',
    payload: { amount: 5 },
    success: true,
    idempotencyKey: randomUUID(),
    ...over,
  });

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    txContext = new TypeOrmTransactionContext();
    repo = new PlatformAdminAuditRepository(
      new TypeOrmRepositoryHelper(db, txContext),
    );
  }, 60000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('a mesma chave com sucesso duas vezes viola o índice único (23505)', async () => {
    const key = randomUUID();
    await repo.insert(base({ idempotencyKey: key }));
    await expect(
      repo.insert(base({ idempotencyKey: key })),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    expect((await repo.findSuccessfulGrantByKey(key))?.idempotencyKey).toBe(
      key,
    );
  });

  it('linhas de falha com a mesma chave são permitidas', async () => {
    const key = randomUUID();
    await repo.insert(base({ idempotencyKey: key, success: false }));
    await repo.insert(base({ idempotencyKey: key, success: false }));
    await repo.insert(base({ idempotencyKey: key, success: true }));
    expect(await repo.findSuccessfulGrantByKey(key)).toMatchObject({
      success: true,
    });
  });

  it('rollback da transação externa remove a linha de sucesso', async () => {
    const key = randomUUID();
    await expect(
      db.transaction(async (manager) => {
        await txContext.run(manager, () =>
          repo.insert(base({ idempotencyKey: key })),
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await repo.findSuccessfulGrantByKey(key)).toBeNull();
  });

  it('listPage devolve a mais recente primeiro e continua pelo cursor', async () => {
    const actor = randomUUID();
    const marker = `page-${randomUUID()}`;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await repo.insert(
        base({
          actorUserId: actor,
          action: 'user_viewed',
          idempotencyKey: null,
          reason: marker,
        }),
      );
      ids.push(e.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const first = await repo.listPage({ limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.data[0].id).toBe(ids[2]);
    expect(first.data[1].id).toBe(ids[1]);
    expect(first.pagination.hasMore).toBe(true);
    const second = await repo.listPage({
      limit: 2,
      cursor: first.pagination.nextCursor!,
    });
    expect(second.data[0].id).not.toBe(ids[2]);
    expect(second.data.map((e) => e.id)).not.toContain(ids[1]);
    const all = await repo.listPage({ limit: 100 });
    expect(all.data.map((e) => e.id).filter((id) => ids.includes(id))).toEqual([
      ids[2],
      ids[1],
      ids[0],
    ]);
  });
});
