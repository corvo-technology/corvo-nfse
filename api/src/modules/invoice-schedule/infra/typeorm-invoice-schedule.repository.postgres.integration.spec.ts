import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { InvoiceSchedule } from '../domain/invoice-schedule';
import { TypeOrmInvoiceScheduleRepository } from './typeorm-invoice-schedule.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `sched_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const NOW = new Date('2026-11-06T15:00:00Z');

function schedule(
  tenantId: string,
  firstOn: string,
  over: Partial<{ kind: 'once' | 'recurring' }> = {},
): InvoiceSchedule {
  const kind = over.kind ?? 'recurring';
  return InvoiceSchedule.create(
    {
      tenantId,
      environment: 'live',
      companyId: randomUUID(),
      kind,
      frequency: kind === 'recurring' ? 'WEEKLY' : null,
      firstOn,
      endsOn: null,
      invoiceInput: { amount: 100, customer: { name: 'Ana' } },
      createdBy: 'user-1',
    },
    NOW,
    15,
  );
}

describePostgres('invoice schedule repository with restricted role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmInvoiceScheduleRepository;
  const context = new TypeOrmTransactionContext();

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
    repo = new TypeOrmInvoiceScheduleRepository(runtime, context);
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('stores and reads a schedule back, dates as plain YYYY-MM-DD strings', async () => {
    const created = schedule(tenantA, '2026-11-09');
    await repo.insert(created);
    const found = await repo.findById(created.props.id, tenantA);
    expect(found?.props).toMatchObject({
      anchorOn: '2026-11-09',
      nextRunOn: '2026-11-09',
      endsOn: null,
      status: 'active',
      frequency: 'WEEKLY',
      invoiceInput: { amount: 100, customer: { name: 'Ana' } },
    });
  });

  it('another tenant neither reads nor changes it (RLS)', async () => {
    const created = schedule(tenantA, '2026-11-09');
    await repo.insert(created);
    expect(await repo.findById(created.props.id, tenantB)).toBeNull();
    const listed = await repo.list(tenantB, {}, { limit: 50, offset: 0 });
    expect(listed.items.map((s) => s.props.id)).not.toContain(created.props.id);
    // A write scoped to the other tenant does not reach the row.
    created.pause();
    await runWithTenant(tenantB, () =>
      repo.save(
        InvoiceSchedule.restore({ ...created.props, tenantId: tenantB }),
      ),
    );
    expect((await repo.findById(created.props.id, tenantA))?.props.status).toBe(
      'active',
    );
  });

  it('save persists a state change; list filters by status; countActive counts', async () => {
    const created = schedule(tenantB, '2026-11-10');
    await repo.insert(created);
    const before = await repo.countActive(tenantB);
    created.pause();
    await repo.save(created);
    expect(await repo.countActive(tenantB)).toBe(before - 1);
    const paused = await repo.list(
      tenantB,
      { status: 'paused' },
      { limit: 50, offset: 0 },
    );
    expect(paused.items.map((s) => s.props.id)).toContain(created.props.id);
    expect(paused.total).toBeGreaterThanOrEqual(1);
  });

  it('claims only active schedules that are due, oldest first, and leaves future/paused/cancelled ones', async () => {
    const tenant = randomUUID();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    const later = schedule(tenant, '2026-11-12');
    const earlier = schedule(tenant, '2026-11-09');
    const future = schedule(tenant, '2026-11-20');
    const paused = schedule(tenant, '2026-11-09');
    const cancelled = schedule(tenant, '2026-11-09');
    for (const s of [later, earlier, future, paused, cancelled])
      await repo.insert(s);
    paused.pause();
    await repo.save(paused);
    cancelled.cancel();
    await repo.save(cancelled);

    const claimed = await runInTransaction(tenant, () =>
      repo.claimDueForTenant(tenant, '2026-11-12', 50),
    );
    expect(claimed.map((s) => s.props.id)).toEqual([
      earlier.props.id,
      later.props.id,
    ]);
  });

  it('two concurrent claimers never receive the same schedule', async () => {
    const tenant = randomUUID();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = schedule(tenant, '2026-11-09');
      ids.push(s.props.id);
      await repo.insert(s);
    }
    let release!: () => void;
    const hold = new Promise<void>((done) => (release = done));
    const first = runInTransaction(tenant, async () => {
      const got = await repo.claimDueForTenant(tenant, '2026-11-09', 3);
      await hold; // keeps the locks until the second claimer has run
      return got;
    });
    await new Promise((done) => setTimeout(done, 150));
    const second = await runInTransaction(tenant, () =>
      repo.claimDueForTenant(tenant, '2026-11-09', 10),
    );
    release();
    const firstGot = await first;
    const a = firstGot.map((s) => s.props.id);
    const b = second.map((s) => s.props.id);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect([...a, ...b].sort()).toEqual([...ids].sort());
  });

  it('listDueTenantIds returns the tenants with something due, and not the others', async () => {
    const due = randomUUID();
    const notDue = randomUUID();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      due,
      notDue,
    ]);
    await repo.insert(schedule(due, '2026-11-09'));
    await repo.insert(schedule(notDue, '2026-11-20'));
    const tenants = await repo.listDueTenantIds('2026-11-10', 1000);
    expect(tenants).toContain(due);
    expect(tenants).not.toContain(notDue);
  });

  it('listDueTenantIds pages by tenant id so a tenant whose schedules stay due is visited once', async () => {
    const tenants = [randomUUID(), randomUUID(), randomUUID()].sort();
    for (const id of tenants)
      await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
        id,
      ]);
    for (const id of tenants) await repo.insert(schedule(id, '2026-11-09'));
    const first = await repo.listDueTenantIds('2026-11-10', 1000);
    const mine = first.filter((id) => tenants.includes(id));
    expect(mine).toEqual(tenants);
    const after = await repo.listDueTenantIds('2026-11-10', 1000, tenants[1]);
    expect(after).toContain(tenants[2]);
    expect(after).not.toContain(tenants[0]);
    expect(after).not.toContain(tenants[1]);
  });

  it('nextAttempt reads the log: 1 when empty, then one more than the highest attempt of that occurrence', async () => {
    const created = schedule(tenantA, '2026-11-09');
    await repo.insert(created);
    const next = (day: string) =>
      repo.nextAttempt(created.props.id, tenantA, day);
    expect(await next('2026-11-09')).toBe(1);
    const base = {
      tenantId: tenantA,
      scheduleId: created.props.id,
      occurrenceOn: '2026-11-09',
      ranOn: '2026-11-09',
      outcome: 'failed' as const,
      invoiceId: null,
      errorCode: null,
      errorMessage: null,
    };
    await repo.addRun({ ...base, attempt: 1 });
    await repo.addRun({ ...base, attempt: 2 });
    expect(await next('2026-11-09')).toBe(3);
    expect(await next('2026-11-16')).toBe(1);
    expect(
      await repo.nextAttempt(created.props.id, tenantB, '2026-11-09'),
    ).toBe(1);
  });

  it('nextAttempts and addRuns do the work of many schedules in one statement each', async () => {
    const one = schedule(tenantA, '2026-11-09');
    const two = schedule(tenantA, '2026-11-09');
    await repo.insert(one);
    await repo.insert(two);
    const run = (scheduleId: string, attempt: number) => ({
      tenantId: tenantA,
      scheduleId,
      occurrenceOn: '2026-11-09',
      ranOn: '2026-11-09',
      attempt,
      outcome: 'failed' as const,
      invoiceId: null,
      errorCode: null,
      errorMessage: null,
    });
    await repo.addRuns(tenantA, [
      run(one.props.id, 1),
      run(one.props.id, 2),
      run(two.props.id, 1),
    ]);
    const items = [
      { scheduleId: one.props.id, occurrenceOn: '2026-11-09' },
      { scheduleId: two.props.id, occurrenceOn: '2026-11-09' },
      { scheduleId: two.props.id, occurrenceOn: '2026-11-16' },
    ];
    const next = await repo.nextAttempts(tenantA, items);
    expect(next.get(`${one.props.id}:2026-11-09`)).toBe(3);
    expect(next.get(`${two.props.id}:2026-11-09`)).toBe(2);
    expect(next.get(`${two.props.id}:2026-11-16`)).toBe(1);
    const other = await repo.nextAttempts(tenantB, items);
    expect(other.get(`${one.props.id}:2026-11-09`)).toBe(1);
  });

  it('review: a FOR UPDATE read waits for the runner and then sees what the runner saved', async () => {
    const tenant = randomUUID();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    const created = schedule(tenant, '2026-11-09');
    await repo.insert(created);
    let release!: () => void;
    const hold = new Promise<void>((done) => (release = done));
    const runner = runInTransaction(tenant, async () => {
      const [claimed] = await repo.claimDueForTenant(tenant, '2026-11-09', 10);
      claimed.recordIssued('2026-11-09'); // next_run_on moves to 2026-11-16
      await repo.save(claimed);
      await hold;
    });
    await new Promise((done) => setTimeout(done, 150));
    let seen: string | null | undefined;
    const mutation = runInTransaction(tenant, async () => {
      const row = await repo.findById(created.props.id, tenant, {
        forUpdate: true,
      });
      seen = row?.props.nextRunOn;
    });
    await new Promise((done) => setTimeout(done, 300));
    expect(seen).toBeUndefined(); // still blocked by the runner's row lock
    release();
    await Promise.all([runner, mutation]);
    expect(seen).toBe('2026-11-16'); // and it read the runner's result, not a stale copy
  });

  it('review: the idempotency key is unique per (tenant, environment) and findByIdempotencyKey finds it', async () => {
    const make = (environment: 'test' | 'live', key: string | null) =>
      InvoiceSchedule.create(
        {
          tenantId: tenantA,
          environment,
          companyId: randomUUID(),
          kind: 'once',
          frequency: null,
          firstOn: '2026-11-09',
          endsOn: null,
          invoiceInput: { amount: 1 },
          createdBy: null,
          idempotencyKey: key,
          requestHash: key ? 'hash-1' : null,
        },
        NOW,
        15,
      );
    const key = `k-${randomUUID()}`;
    const first = make('live', key);
    await repo.insert(first);
    await expect(repo.insert(make('live', key))).rejects.toMatchObject({
      code: '23505',
    });
    await repo.insert(make('test', key)); // another environment: fine
    await repo.insert(make('live', null)); // no key: never conflicts
    await repo.insert(make('live', null));
    const found = await repo.findByIdempotencyKey(tenantA, 'live', key);
    expect(found?.props).toMatchObject({
      id: first.props.id,
      idempotencyKey: key,
      requestHash: 'hash-1',
    });
    expect(await repo.findByIdempotencyKey(tenantB, 'live', key)).toBeNull();
  });

  it('a run is unique per (schedule, occurrence, attempt) and listRuns returns newest first', async () => {
    const created = schedule(tenantA, '2026-11-09');
    await repo.insert(created);
    const run = {
      tenantId: tenantA,
      scheduleId: created.props.id,
      occurrenceOn: '2026-11-09',
      ranOn: '2026-11-09',
      attempt: 1,
      outcome: 'failed' as const,
      invoiceId: null,
      errorCode: 'ERROR_QUOTA_EXCEEDED',
      errorMessage: 'no credits',
    };
    await repo.addRun(run);
    await expect(repo.addRun(run)).rejects.toThrow();
    await repo.addRun({
      ...run,
      attempt: 2,
      outcome: 'issued',
      invoiceId: randomUUID(),
      errorCode: null,
      errorMessage: null,
    });
    const runs = await repo.listRuns(created.props.id, tenantA, {
      limit: 10,
      offset: 0,
    });
    expect(runs.total).toBe(2);
    expect(runs.items[0]).toMatchObject({
      attempt: 2,
      outcome: 'issued',
      occurrenceOn: '2026-11-09',
    });
    expect(
      await repo.listRuns(created.props.id, tenantB, { limit: 10, offset: 0 }),
    ).toMatchObject({ total: 0 });
  });

  /**
   * Runs `work` in its own transaction, like the runner does: the tenant scope wraps the
   * transaction, because the RLS settings are applied when the connection is acquired.
   */
  function runInTransaction<T>(
    tenantId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return runWithTenant(tenantId, () =>
      runtime.transaction((manager) => context.run(manager, work)),
    );
  }
});
