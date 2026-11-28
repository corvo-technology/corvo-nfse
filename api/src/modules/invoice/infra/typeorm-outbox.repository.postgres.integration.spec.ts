import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmOutboxRepository } from './typeorm-outbox.repository';
import type { NewOutboxMessage } from '../domain/outbox-message';
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `outbox_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
describePostgres('outbox repository with restricted PostgreSQL role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmOutboxRepository;
  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    if (!owner) throw new Error('Migration owner was not returned');
    // Exercise the reviewed provisioning artifact, including a repeated invocation.
    for (let index = 0; index < 2; index++)
      execFileSync(
        'psql',
        [
          url,
          '-w',
          '-v',
          `runtime_role=${role}`,
          '-v',
          `migration_role=${owner.role}`,
          '-v',
          `app_schema=${schema}`,
          '-f',
          resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
        ],
        { stdio: 'pipe' },
      );
    const runtimeUrl = new URL(url);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const options = createTypeOrmOptions({
      url: runtimeUrl.toString(),
      schema,
      ssl: false,
      logging: false,
    });
    runtime = new DataSource({
      ...options,
      extra: { ...options.extra, max: 4 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    repo = new TypeOrmOutboxRepository(
      runtime,
      new TypeOrmTransactionContext(),
    );
  }, 60000);
  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });
  const base = (dedupeKey: string, availableAt?: Date): NewOutboxMessage => ({
    tenantId: tenantA,
    environment: 'live',
    type: 'invoice.emit',
    aggregateId: randomUUID(),
    payload: { invoiceId: 'x' },
    dedupeKey,
    availableAt,
  });

  it('inserts once per (tenant, dedupeKey)', async () => {
    await runWithTenant(tenantA, async () => {
      expect(await repo.insert(base('emission:1'))).toBe(true);
      expect(await repo.insert(base('emission:1'))).toBe(false);
    });
  });

  it('claims only due messages and leaves future ones', async () => {
    const future = new Date(Date.now() + 3_600_000);
    await runWithTenant(tenantA, async () => {
      await repo.insert(base('due-1'));
      await repo.insert(base('future-1', future));
    });
    const now = new Date();
    const claimed = await runAsSystem('outbox-relay', () =>
      repo.claimBatch(now, 10, new Date(now.getTime() + 60_000)),
    );
    expect(claimed.map((m) => m.dedupeKey)).toContain('due-1');
    expect(claimed.map((m) => m.dedupeKey)).not.toContain('future-1');
    expect(
      claimed.every((m) => m.status === 'claimed' && m.attempts === 1),
    ).toBe(true);
  });

  it('claims live messages before test ones, even when the test ones are older and far more numerous', async () => {
    const old = new Date(Date.now() - 600_000);
    await runWithTenant(tenantA, async () => {
      for (let i = 0; i < 30; i++)
        await repo.insert({
          ...base(`prio-test-${i}`, old),
          environment: 'test',
        });
      for (let i = 0; i < 3; i++) await repo.insert(base(`prio-live-${i}`));
    });
    const now = new Date();
    const claimed = await runAsSystem('outbox-relay', () =>
      repo.claimBatch(now, 10, new Date(now.getTime() + 60_000)),
    );
    const keys = claimed.map((m) => m.dedupeKey);
    // Every live message is in the batch, and listed before any test message.
    for (let i = 0; i < 3; i++) expect(keys).toContain(`prio-live-${i}`);
    const firstTest = claimed.findIndex((m) => m.environment === 'test');
    const lastLive = claimed.map((m) => m.environment).lastIndexOf('live');
    expect(firstTest).toBeGreaterThan(lastLive);
    // The test flood is capped to a fifth of the batch (2 of 10).
    expect(claimed.filter((m) => m.environment === 'test')).toHaveLength(2);
  });

  it('a full batch of live messages still lets one test message through, so test never starves', async () => {
    await runWithTenant(tenantA, async () => {
      for (let i = 0; i < 12; i++) await repo.insert(base(`sat-live-${i}`));
      for (let i = 0; i < 3; i++)
        await repo.insert({ ...base(`sat-test-${i}`), environment: 'test' });
    });
    const now = new Date();
    const claimed = await runAsSystem('outbox-relay', () =>
      repo.claimBatch(now, 10, new Date(now.getTime() + 60_000)),
    );
    expect(claimed.filter((m) => m.environment === 'live')).toHaveLength(10);
    expect(claimed.filter((m) => m.environment === 'test')).toHaveLength(1);
  });

  it('two concurrent claimers never receive the same message', async () => {
    await runWithTenant(tenantA, async () => {
      for (let i = 0; i < 20; i++) await repo.insert(base(`race-${i}`));
    });
    const now = new Date();
    const lease = new Date(now.getTime() + 60_000);
    const [a, b] = await Promise.all([
      runAsSystem('outbox-relay', () => repo.claimBatch(now, 20, lease)),
      runAsSystem('outbox-relay', () => repo.claimBatch(now, 20, lease)),
    ]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      [...a, ...b]
        .filter((message) => message.dedupeKey.startsWith('race-'))
        .map((message) => message.dedupeKey)
        .sort(),
    ).toEqual(Array.from({ length: 20 }, (_, index) => `race-${index}`).sort());
  });

  it('reclaims a message whose lease expired', async () => {
    await runWithTenant(tenantA, () => repo.insert(base('lease-1')));
    const t0 = new Date();
    const [first] = (
      await runAsSystem('outbox-relay', () =>
        repo.claimBatch(t0, 100, new Date(t0.getTime() + 1_000)),
      )
    ).filter((m) => m.dedupeKey === 'lease-1');
    if (!first) throw new Error('Expected initial lease claim');
    const later = new Date(t0.getTime() + 5_000);
    const again = (
      await runAsSystem('outbox-relay', () =>
        repo.claimBatch(later, 100, new Date(later.getTime() + 1_000)),
      )
    ).find((m) => m.id === first.id);
    expect(again?.attempts).toBe(2);
  });

  it('complete, release and markDead mutate only the active claim in tenant scope', async () => {
    await runWithTenant(tenantA, async () => {
      for (const key of ['state-release', 'state-dead', 'state-complete'])
        await repo.insert(base(key));
    });
    const now = new Date();
    const claimed = await runAsSystem('outbox-relay', () =>
      repo.claimBatch(now, 100, new Date(now.getTime() + 60000)),
    );
    const find = (key: string) => {
      const message = claimed.find((row) => row.dedupeKey === key);
      if (!message) throw new Error(`Expected ${key} claim`);
      return message;
    };
    const released = find('state-release');
    const dead = find('state-dead');
    const completed = find('state-complete');
    await runWithTenant(tenantA, async () => {
      expect(
        await repo.release(
          released.id,
          tenantA,
          'boom',
          new Date(now.getTime() + 10000),
          now,
          released.attempts,
        ),
      ).toBe(true);
      expect(
        await repo.markDead(dead.id, tenantA, 'dead', now, dead.attempts),
      ).toBe(true);
      expect(
        await repo.complete(completed.id, tenantA, now, completed.attempts),
      ).toBe(true);
      expect(await repo.complete(dead.id, tenantA, now, dead.attempts)).toBe(
        false,
      );
    });
    expect(
      await admin.query(
        `SELECT status, last_error FROM "${schema}".outbox_messages WHERE id=$1`,
        [released.id],
      ),
    ).toEqual([{ status: 'pending', last_error: 'boom' }]);
    expect(
      await admin.query(
        `SELECT status, last_error FROM "${schema}".outbox_messages WHERE id=$1`,
        [dead.id],
      ),
    ).toEqual([{ status: 'dead', last_error: 'dead' }]);
    expect(
      await admin.query(
        `SELECT status, lease_until, completed_at FROM "${schema}".outbox_messages WHERE id=$1`,
        [completed.id],
      ),
    ).toEqual([{ status: 'completed', lease_until: null, completed_at: now }]);
  });

  it('rejects stale claimant completion, release and dead updates after lease takeover', async () => {
    await runWithTenant(tenantA, () => repo.insert(base('stale-claim')));
    const started = new Date();
    const claim = async (at: Date) => {
      const message = (
        await runAsSystem('outbox-relay', () =>
          repo.claimBatch(at, 100, new Date(at.getTime() + 1000)),
        )
      ).find((row) => row.dedupeKey === 'stale-claim');
      if (!message) throw new Error('Expected stale claim fixture');
      return message;
    };
    const first = await claim(started);
    const second = await claim(new Date(started.getTime() + 2000));
    expect(second.attempts).toBe(first.attempts + 1);
    await runWithTenant(tenantA, () =>
      repo.complete(first.id, tenantA, started, first.attempts),
    );
    expect(
      await admin.query(
        `SELECT status, attempts FROM "${schema}".outbox_messages WHERE id=$1`,
        [second.id],
      ),
    ).toEqual([{ status: 'claimed', attempts: second.attempts }]);
    await runWithTenant(tenantA, () =>
      repo.complete(second.id, tenantA, started, second.attempts),
    );
    await runWithTenant(tenantA, () =>
      repo.release(
        first.id,
        tenantA,
        'late failure',
        started,
        started,
        first.attempts,
      ),
    );
    await runWithTenant(tenantA, () =>
      repo.markDead(first.id, tenantA, 'late dead', started, first.attempts),
    );
    expect(
      await admin.query(
        `SELECT status, attempts, last_error FROM "${schema}".outbox_messages WHERE id=$1`,
        [second.id],
      ),
    ).toEqual([
      { status: 'completed', attempts: second.attempts, last_error: null },
    ]);
  });

  it('allows the same dedupe key in different tenants and isolates targeted reads', async () => {
    await runWithTenant(tenantA, () => repo.insert(base('tenant-shared')));
    await runWithTenant(tenantB, async () => {
      expect(
        await repo.insert({ ...base('tenant-shared'), tenantId: tenantB }),
      ).toBe(true);
      const rows = await runtime.query(
        `SELECT tenant_id FROM "${schema}".outbox_messages WHERE dedupe_key=$1`,
        ['tenant-shared'],
      );
      expect(rows).toEqual([{ tenant_id: tenantB }]);
    });
  });

  describe('reviveStalledInvoices', () => {
    const old = new Date(Date.now() - 3_600_000);
    const cutoff = new Date(Date.now() - 1_800_000);
    let company: string;
    beforeAll(async () => {
      company = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
        [company, tenantA],
      );
    });
    const invoice = async (status: string, createdAt: Date) => {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".nfse_invoices (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment,created_at) VALUES ($1,$2,$3,$4,'{}','{}','{}',10,'2026-10-11','test',$5)`,
        [id, company, tenantA, status, createdAt],
      );
      return id;
    };
    const message = async (
      aggregateId: string,
      type: string,
      status: string,
      updatedAt: Date,
    ) => {
      await runWithTenant(tenantA, () =>
        repo.insert({
          ...base(`${type}:${aggregateId}`),
          type,
          aggregateId,
        }),
      );
      await admin.query(
        `UPDATE "${schema}".outbox_messages SET status=$2, attempts=5, updated_at=$3 WHERE aggregate_id=$1 AND type=$4`,
        [aggregateId, status, updatedAt, type],
      );
    };
    const statusOf = async (aggregateId: string) =>
      (
        await admin.query<Array<{ status: string }>>(
          `SELECT type, status, attempts FROM "${schema}".outbox_messages WHERE aggregate_id=$1 ORDER BY type`,
          [aggregateId],
        )
      ).map((r) => r.status);

    it('puts the messages of an invoice stuck in queued back to pending', async () => {
      const dead = await invoice('queued', old);
      await message(dead, 'invoice.calculate-taxes', 'completed', old);
      await message(dead, 'invoice.emit', 'dead', old);
      const revived = await runWithTenant(tenantA, () =>
        repo.reviveStalledInvoices(tenantA, cutoff, 100),
      );
      expect(revived).toBeGreaterThanOrEqual(1);
      expect(await statusOf(dead)).toEqual(['pending', 'pending']);
      const [row] = await admin.query<Array<{ attempts: number }>>(
        `SELECT attempts FROM "${schema}".outbox_messages WHERE aggregate_id=$1 AND type='invoice.emit'`,
        [dead],
      );
      expect(row?.attempts).toBe(0);
    });

    it('leaves alone a scheduled or in-flight invoice, a recent one and one already final', async () => {
      const scheduled = await invoice('queued', old);
      await message(scheduled, 'invoice.emit', 'pending', old);
      const inFlight = await invoice('queued', old);
      await message(inFlight, 'invoice.emit', 'claimed', old);
      const recent = await invoice('queued', new Date());
      await message(recent, 'invoice.emit', 'dead', old);
      const authorized = await invoice('authorized', old);
      await message(authorized, 'invoice.emit', 'dead', old);
      await runWithTenant(tenantA, () =>
        repo.reviveStalledInvoices(tenantA, cutoff, 100),
      );
      expect(await statusOf(scheduled)).toEqual(['pending']);
      expect(await statusOf(inFlight)).toEqual(['claimed']);
      expect(await statusOf(recent)).toEqual(['dead']);
      expect(await statusOf(authorized)).toEqual(['dead']);
    });

    it('never touches another workspace', async () => {
      const mine = await invoice('queued', old);
      await message(mine, 'invoice.emit', 'dead', old);
      const revived = await runWithTenant(tenantB, () =>
        repo.reviveStalledInvoices(tenantB, cutoff, 100),
      );
      expect(revived).toBe(0);
      expect(await statusOf(mine)).toEqual(['dead']);
    });
  });

  it('RLS hides tenant A messages from tenant B', async () => {
    const rows = await runWithTenant(tenantB, () =>
      runtime.query(
        `SELECT id FROM "${schema}".outbox_messages WHERE tenant_id=$1`,
        [tenantA],
      ),
    );
    expect(rows).toEqual([]);
  });
});
