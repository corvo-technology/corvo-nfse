import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';
import { InvoiceSchedule } from '../domain/invoice-schedule';
import { TypeOrmInvoiceScheduleRepository } from '../infra/typeorm-invoice-schedule.repository';
import { ScheduleRunner } from './schedule-runner.service';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `sched_run_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenant = randomUUID();
const NOW = new Date('2026-11-06T15:00:00Z');
const TODAY = '2026-11-09';

describePostgres('schedule runner against real transactions', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmInvoiceScheduleRepository;
  let runner: ScheduleRunner;
  const context = new TypeOrmTransactionContext();
  const keyByInvoice = new Map<string, string>();
  let submitDelayMs = 0;

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    // Stands in for nfse_invoices: one row per idempotency key, written inside the runner's transaction.
    await admin.query(
      `CREATE TABLE "${schema}".schedule_test_notes (idempotency_key text PRIMARY KEY)`,
    );
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
    await admin.query(
      `GRANT SELECT, INSERT ON "${schema}".schedule_test_notes TO "${role}"`,
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
      extra: { ...options.extra, max: 6 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    repo = new TypeOrmInvoiceScheduleRepository(runtime, context);
    runner = new ScheduleRunner(
      repo,
      {
        prepareEmissionInEnvironment: (
          dto: Record<string, unknown>,
          _tenant: string,
          _env: string,
          key: string,
        ) => {
          const id = randomUUID();
          keyByInvoice.set(id, key);
          return Promise.resolve({
            kind: 'ready',
            invoice: { id, companyId: dto.companyId },
            event: {},
            requestHash: 'h',
          });
        },
      } as never,
      {
        submitBatch: async (
          _tenant: string,
          entries: { invoice: { id: string } }[],
        ) => {
          const manager = context.getManager();
          if (!manager) throw new Error('Expected the runner transaction');
          for (const entry of entries)
            await manager.query(
              `INSERT INTO "${schema}".schedule_test_notes (idempotency_key) VALUES ($1)`,
              [keyByInvoice.get(entry.invoice.id)],
            );
          // Keeps the row locks long enough for a second runner to collide with this one.
          await new Promise((done) => setTimeout(done, submitDelayMs));
          return entries.map(() => ({ ok: true }));
        },
      } as never,
      { findByIdempotencyKey: () => Promise.resolve(null) },
      new TypeOrmUnitOfWork(runtime, context),
      {
        retryNotice: () => Promise.resolve(),
        paused: () => Promise.resolve(),
      },
      {
        validate: () => Promise.resolve({ companyId: '' }),
        issue: () => Promise.resolve({ id: '' }),
      },
      500,
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

  beforeEach(() => {
    submitDelayMs = 0;
  });

  const newSchedule = () =>
    InvoiceSchedule.create(
      {
        tenantId: tenant,
        environment: 'live',
        companyId: randomUUID(),
        kind: 'recurring',
        frequency: 'WEEKLY',
        firstOn: TODAY,
        endsOn: null,
        invoiceInput: { companyId: randomUUID(), amount: 100 },
        createdBy: null,
      },
      NOW,
      15,
    );
  const notesFor = async (scheduleId: string) => {
    const rows: Array<{ idempotency_key: string }> = await admin.query(
      `SELECT idempotency_key FROM "${schema}".schedule_test_notes WHERE idempotency_key LIKE $1`,
      [`schedule:${scheduleId}:%`],
    );
    return rows.map((row) => row.idempotency_key);
  };

  it('review focus 1: two runners at the same time issue the occurrence exactly once', async () => {
    const schedule = newSchedule();
    await repo.insert(schedule);
    submitDelayMs = 400;
    const [a, b] = await Promise.all([
      runner.runDue(TODAY),
      runner.runDue(TODAY),
    ]);
    expect(a.issued + b.issued).toBe(1);
    expect(a.errors + b.errors).toBe(0);
    expect(await notesFor(schedule.props.id)).toEqual([
      `schedule:${schedule.props.id}:${TODAY}`,
    ]);
    const stored = await repo.findById(schedule.props.id, tenant);
    expect(stored?.props.nextRunOn).toBe('2026-11-16');
    const runs = await repo.listRuns(schedule.props.id, tenant, {
      limit: 10,
      offset: 0,
    });
    expect(runs.total).toBe(1);
  });

  it('review focus 2: a crash after the note was created but before the schedule advanced leaves nothing behind, and the rerun issues it once', async () => {
    const schedule = newSchedule();
    await repo.insert(schedule);
    const realSave = repo.save.bind(repo);
    repo.save = () => Promise.reject(new Error('process died'));
    const crashed = await runner.runDue(TODAY);
    repo.save = realSave;
    expect(crashed).toMatchObject({ issued: 0, errors: 1 });
    expect(await notesFor(schedule.props.id)).toEqual([]); // the note rolled back with the schedule
    const untouched = await repo.findById(schedule.props.id, tenant);
    expect(untouched?.props).toMatchObject({
      nextRunOn: TODAY,
      attempts: 0,
    });

    const rerun = await runner.runDue(TODAY);
    expect(rerun.issued).toBe(1);
    expect(await notesFor(schedule.props.id)).toHaveLength(1);
    expect(
      (await repo.findById(schedule.props.id, tenant))?.props.nextRunOn,
    ).toBe('2026-11-16');
  });

  it('a paused schedule is not issued even though it was due', async () => {
    const schedule = newSchedule();
    await repo.insert(schedule);
    schedule.pause();
    await repo.save(schedule);
    const result = await runner.runDue(TODAY);
    expect(result.issued).toBe(0);
    expect(await notesFor(schedule.props.id)).toEqual([]);
  });
});
