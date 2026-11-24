/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client, Query } from 'pg';
import { DataSource } from 'typeorm';
import { installRlsConnectionScope } from './rls-connection-scope';
import { RlsConnectionScopeService } from './rls-connection-scope.service';
import { createTypeOrmOptions } from './typeorm.options';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import {
  runAsSystem,
  runWithTenant,
  runWithoutDatabaseScope,
} from '@/infra/persistence/typeorm/tenant-context.storage';

/**
 * Tenant/system scope behind a real PgBouncer in TRANSACTION pooling mode, the way
 * the managed Postgres runs in production (two statements of one client can land on
 * different server connections). The schema is built by the real migrations, the
 * runtime role is provisioned by scripts/provision-runtime-role.sql and the runtime
 * DataSource uses the application's own TypeORM options. Needs:
 *   MIGRATION_TEST_DATABASE_URL  direct, owner/superuser, local `_test` database
 *   PGBOUNCER_TEST_URL           same database through PgBouncer (pool_mode=transaction)
 *                                as user corvo_pgb_runtime / password pgb
 * CI runs edoburu/pgbouncer as a service; locally see api/TENANT_ISOLATION.md.
 */
const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const poolerUrl = process.env.PGBOUNCER_TEST_URL;
if (
  adminUrl &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname) ||
    !new URL(adminUrl).pathname.endsWith('_test'))
)
  throw new Error('PgBouncer RLS integration requires a local _test database');
const describePooler = adminUrl && poolerUrl ? describe : describe.skip;

const schema = `rls_pgb_${randomUUID().replaceAll('-', '')}`;
const runtimeRole = poolerUrl
  ? decodeURIComponent(new URL(poolerUrl).username)
  : '';
const runtimePassword = poolerUrl
  ? decodeURIComponent(new URL(poolerUrl).password)
  : '';
const tenants = [randomUUID(), randomUUID(), randomUUID()];
const items = tenants.map(() => randomUUID());
const companies = tenants.map(() => randomUUID());
const table = `"${schema}"."probe_items"`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => sleep(Math.random() * 15);

describePooler('tenant scope behind PgBouncer in transaction mode', () => {
  let admin: Client;
  let runtime: DataSource;
  let migrator: DataSource;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
        CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS;
      END IF; END $$`);
    await admin.query(
      `ALTER ROLE "${runtimeRole}" NOSUPERUSER NOBYPASSRLS PASSWORD '${runtimePassword}'`,
    );
    await admin.query(`CREATE SCHEMA "${schema}"`);
    // The real schema: every migration, so the real RLS policies are in place.
    migrator = new DataSource(
      createTypeOrmOptions({
        url: adminUrl!,
        schema,
        ssl: false,
        logging: false,
      }),
    );
    await migrator.initialize();
    await migrator.runMigrations();
    const owner = (await admin.query('SELECT current_user AS role')).rows[0]
      .role as string;
    execFileSync(
      'psql',
      [
        adminUrl!,
        '-w',
        '-v',
        `runtime_role=${runtimeRole}`,
        '-v',
        `migration_role=${owner}`,
        '-v',
        `app_schema=${schema}`,
        '-f',
        resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
      ],
      { stdio: 'pipe' },
    );
    // A small probe table, with the same policy shape as the real tables.
    await admin.query(
      `CREATE TABLE ${table} (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, counter int NOT NULL DEFAULT 0)`,
    );
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY tenant_isolation_policy ON ${table}
      USING (tenant_id::text = current_setting('app.current_tenant_id', true) OR current_setting('app.system_context', true) = 'on')
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true) OR current_setting('app.system_context', true) = 'on')`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO "${runtimeRole}"`,
    );
    await admin.query(
      `INSERT INTO "${schema}"."tenants" (id) VALUES ($1),($2),($3)`,
      tenants,
    );
    for (const [index, tenant] of tenants.entries())
      await admin.query(
        `INSERT INTO "${schema}"."nfse_companies" (id, tenant_id, legal_name, tax_id, environment) VALUES ($1, $2, 'Fixture', '11222333000181', 'test')`,
        [companies[index], tenant],
      );
    for (const [index, tenant] of tenants.entries())
      await admin.query(
        `INSERT INTO ${table} (id, tenant_id) VALUES ($1, $2)`,
        [items[index], tenant],
      );

    // The application's own options (entities, schema, pool settings), pointed at PgBouncer.
    const options = createTypeOrmOptions({
      url: poolerUrl!,
      schema,
      ssl: false,
      logging: false,
    });
    runtime = new DataSource({
      ...options,
      extra: { ...options.extra, max: 20 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    // The real startup check: restricted role and every policy in place.
    await new RlsConnectionScopeService(runtime).onModuleInit();
  }, 180_000);

  afterAll(async () => {
    await runtime?.destroy();
    await migrator?.destroy();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('is really transaction pooling: session-level settings leak between clients', async () => {
    // Sanity check of the harness. If this fails, the pooler is not in transaction
    // mode and the tests below would prove nothing.
    const clients = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const client = new Client({ connectionString: poolerUrl });
        await client.connect();
        return client;
      }),
    );
    let foreign = 0;
    await Promise.all(
      clients.map(async (client, index) => {
        for (let round = 0; round < 10; round++) {
          await client.query(`SELECT set_config('app.probe', $1, false)`, [
            `c${index}`,
          ]);
          const { rows } = await client.query(
            `SELECT current_setting('app.probe', true) AS value`,
          );
          if (rows[0].value !== `c${index}`) foreign++;
        }
      }),
    );
    await Promise.all(clients.map((client) => client.end()));
    expect(foreign).toBeGreaterThan(0);
  });

  it('never leaks another request scope across concurrent mixed work', async () => {
    const failures: string[] = [];
    const note = (message: string) => failures.push(message);
    const rounds = 40;

    const tenantReader = (index: number) =>
      runWithTenant(tenants[index], async () => {
        // autocommit statements
        const own = await runtime.query(
          `SELECT tenant_id FROM ${table} WHERE id = $1`,
          [items[index]],
        );
        if (own.length !== 1 || own[0].tenant_id !== tenants[index])
          note(`tenant ${index}: own row not found (${own.length} rows)`);
        await jitter();
        const visible = await runtime.query(
          `SELECT DISTINCT tenant_id FROM ${table}`,
        );
        if (visible.length !== 1 || visible[0].tenant_id !== tenants[index])
          note(`tenant ${index}: saw ${visible.length} tenants`);
        const foreign = await runtime.query(
          `SELECT id FROM ${table} WHERE id = $1`,
          [items[(index + 1) % tenants.length]],
        );
        if (foreign.length !== 0) note(`tenant ${index}: read a foreign row`);
        // TypeORM returns [rows, affectedCount] for UPDATE.
        const [, hijacked] = await runtime.query(
          `UPDATE ${table} SET counter = counter + 1000 WHERE id = $1 RETURNING id`,
          [items[(index + 1) % tenants.length]],
        );
        if (hijacked !== 0) note(`tenant ${index}: wrote a foreign row`);
      });

    const tenantTransaction = (index: number) =>
      runWithTenant(tenants[index], () =>
        runtime.transaction(async (manager) => {
          await manager.query(
            `UPDATE ${table} SET counter = counter + 1 WHERE id = $1`,
            [items[index]],
          );
          await jitter();
          const visible = await manager.query(
            `SELECT DISTINCT tenant_id FROM ${table}`,
          );
          if (visible.length !== 1 || visible[0].tenant_id !== tenants[index])
            note(`tenant ${index} tx: saw ${visible.length} tenants`);
          await jitter();
          const settings = await manager.query(
            `SELECT current_setting('app.current_tenant_id', true) AS tenant, current_setting('app.system_context', true) AS system`,
          );
          if (
            settings[0].tenant !== tenants[index] ||
            settings[0].system !== 'off'
          )
            note(
              `tenant ${index} tx: wrong settings ${JSON.stringify(settings[0])}`,
            );
        }),
      );

    const readCommitted = (index: number) =>
      runWithTenant(tenants[index], async () => {
        const runner = runtime.createQueryRunner();
        await runner.connect();
        try {
          await runner.startTransaction('READ COMMITTED');
          const rows = await runner.query(`SELECT id FROM ${table}`);
          if (rows.length !== 1 || rows[0].id !== items[index])
            note(`tenant ${index} READ COMMITTED: saw ${rows.length} rows`);
          await runner.commitTransaction();
        } finally {
          await runner.release();
        }
      });

    const systemWorker = () =>
      runAsSystem('outbox-relay', async () => {
        const all = await runtime.query(`SELECT id FROM ${table}`);
        if (all.length !== tenants.length)
          note(`system: saw ${all.length} of ${tenants.length} rows`);
        await runtime.transaction(async (manager) => {
          // A system-only write: a row of a tenant that is not the caller's, then gone again.
          const id = randomUUID();
          await manager.query(
            `INSERT INTO ${table} (id, tenant_id) VALUES ($1, $2)`,
            [id, randomUUID()],
          );
          await jitter();
          await manager.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        });
      });

    const noScope = () =>
      runWithoutDatabaseScope(async () => {
        const rows = await runtime.query(`SELECT id FROM ${table}`);
        if (rows.length !== 0) note(`no scope: saw ${rows.length} rows`);
        const settings = await runtime.query(
          `SELECT current_setting('app.system_context', true) AS system, current_setting('app.current_tenant_id', true) AS tenant`,
        );
        if (settings[0].system !== 'off' || settings[0].tenant !== '')
          note(`no scope: leaked ${JSON.stringify(settings[0])}`);
      });

    const work: Array<() => Promise<unknown>> = [];
    for (let round = 0; round < rounds; round++)
      for (let index = 0; index < tenants.length; index++) {
        work.push(() => tenantReader(index));
        work.push(() => tenantTransaction(index));
        work.push(() => readCommitted(index));
        work.push(systemWorker);
        work.push(noScope);
      }
    // Everything at once, shuffled.
    work.sort(() => Math.random() - 0.5);
    const results = await Promise.allSettled(work.map((job) => job()));
    for (const result of results)
      if (result.status === 'rejected')
        note(
          `error: ${String((result.reason as Error)?.message ?? result.reason)}`,
        );

    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);

    // Writes landed on the right rows: only the in-transaction increments, none from the hijacks.
    const counters = await admin.query(
      `SELECT id, counter FROM ${table} ORDER BY id`,
    );
    for (const [index] of tenants.entries())
      expect(
        counters.rows.find((row: { id: string }) => row.id === items[index])
          .counter,
      ).toBe(rounds);
  }, 120_000);

  it('does not leave system_context behind on a server connection after a worker transaction', async () => {
    await runAsSystem('outbox-relay', () =>
      runtime.transaction((manager) => manager.query('SELECT 1')),
    );
    const samples = await Promise.all(
      Array.from({ length: 60 }, () =>
        // A raw client without our hook, on the same pooler: whichever server
        // connection it gets must not carry the worker's scope.
        (async () => {
          const client = new Client({ connectionString: poolerUrl });
          await client.connect();
          try {
            const { rows } = await client.query(
              `SELECT current_setting('app.system_context', true) AS system`,
            );
            return rows[0].system as string | null;
          } finally {
            await client.end();
          }
        })(),
      ),
    );
    expect(samples.filter((value) => value === 'on')).toHaveLength(0);
  });

  it('keeps each scope when callers share one QueryRunner and fire autocommit queries concurrently', async () => {
    const runner = runtime.createQueryRunner();
    await runner.connect();
    const failures: string[] = [];
    const jobs: Array<Promise<unknown>> = [];
    const check = (label: string, ok: boolean, detail?: unknown) => {
      if (!ok) failures.push(`${label}: ${JSON.stringify(detail)}`);
    };
    const expectTenant = (index: number) => async () => {
      // no parameters (one message) and with parameters (queued messages)
      const plain = await runner.query(
        `SELECT DISTINCT tenant_id FROM ${table}`,
      );
      check(
        `tenant ${index} plain`,
        plain.length === 1 && plain[0].tenant_id === tenants[index],
        plain,
      );
      const bound = await runner.query(
        `SELECT DISTINCT tenant_id FROM ${table} WHERE counter >= $1`,
        [0],
      );
      check(
        `tenant ${index} bound`,
        bound.length === 1 && bound[0].tenant_id === tenants[index],
        bound,
      );
      const settings = await runner.query(
        `SELECT current_setting('app.current_tenant_id', true) AS tenant, current_setting('app.system_context', true) AS system`,
      );
      check(
        `tenant ${index} settings`,
        settings[0].tenant === tenants[index] && settings[0].system === 'off',
        settings,
      );
    };
    const expectSystem = async () => {
      const all = await runner.query(`SELECT id FROM ${table}`);
      check('system plain', all.length === tenants.length, all.length);
      const bound = await runner.query(
        `SELECT id FROM ${table} WHERE counter >= $1`,
        [0],
      );
      check('system bound', bound.length === tenants.length, bound.length);
    };
    const expectNothing = async () => {
      const rows = await runner.query(`SELECT id FROM ${table}`);
      check('no scope', rows.length === 0, rows.length);
    };
    const expectFailure = async () => {
      // A failing statement must not poison the neighbours or leave a transaction open.
      await runner.query('SELECT definitely_not_a_column FROM nowhere').then(
        () => check('failure', false, 'did not fail'),
        () => undefined,
      );
    };
    for (let round = 0; round < 25; round++) {
      for (const index of tenants.keys()) {
        jobs.push(runWithTenant(tenants[index], expectTenant(index)));
        jobs.push(runAsSystem('outbox-relay', expectSystem));
        jobs.push(runWithoutDatabaseScope(expectNothing));
        if (round % 5 === 0) jobs.push(expectFailure());
      }
    }
    const results = await Promise.allSettled(jobs);
    for (const result of results)
      if (result.status === 'rejected')
        failures.push(`error: ${String(result.reason)}`);
    expect(failures.slice(0, 10)).toEqual([]);
    // Nothing was left open: releasing inside a transaction would fail.
    await runner.release();
  }, 120_000);

  it('applies the scope to the application entities through the real stack', async () => {
    const repository = runtime.getRepository(CompanyOrmEntity);
    const seen = await Promise.all(
      tenants.map((tenant) =>
        runWithTenant(tenant, () =>
          // No tenant predicate on purpose: only RLS narrows this.
          repository.createQueryBuilder('company').getMany(),
        ),
      ),
    );
    seen.forEach((rows, index) => {
      expect(rows.map((row) => row.id)).toEqual([companies[index]]);
    });
    const all = await runAsSystem('outbox-relay', () => repository.count());
    expect(all).toBe(tenants.length);
  });

  describe('streams', () => {
    const collect = (query: Query) =>
      new Promise<Array<{ tenant_id: string }>>((done, fail) => {
        const rows: Array<{ tenant_id: string }> = [];
        query.on('row', (row: { tenant_id: string }) => rows.push(row));
        query.on('error', fail);
        query.on('end', () => done(rows));
      });
    const checkout = async () => {
      const [client, release] = await (
        runtime.driver as unknown as {
          obtainMasterConnection: () => Promise<
            [
              { query: (...args: unknown[]) => unknown },
              (error?: unknown) => void,
            ]
          >;
        }
      ).obtainMasterConnection();
      return { client, release };
    };

    it('streams inside a transaction with the transaction scope', async () => {
      await runWithTenant(tenants[1], async () => {
        const { client, release } = await checkout();
        try {
          await client.query('BEGIN');
          const query = client.query(
            new Query(`SELECT tenant_id FROM ${table}`),
          ) as Query;
          expect(typeof query.on).toBe('function');
          const rows = await collect(query);
          expect(rows.map((row) => row.tenant_id)).toEqual([tenants[1]]);
          await client.query('COMMIT');
        } finally {
          release();
        }
      });
    });

    it('refuses to stream outside an explicit transaction', async () => {
      const { client, release } = await checkout();
      try {
        expect(() => client.query(new Query('SELECT 1'))).toThrow(
          /explicit transaction/,
        );
      } finally {
        release();
      }
    });
  });
});
