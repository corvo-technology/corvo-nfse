import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';

export const migrationTestUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  migrationTestUrl &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(migrationTestUrl).hostname,
  ) ||
    !new URL(migrationTestUrl).pathname.endsWith('_test'))
)
  throw new Error('NF-e integration tests require a local _test database');

/** Like `describe`, but skips (locally) when `MIGRATION_TEST_DATABASE_URL` is not set. CI sets it. */
export const describePostgres = migrationTestUrl ? describe : describe.skip;

export interface PostgresHarness {
  schema: string;
  admin: DataSource;
  runtime: DataSource;
  transactions: TypeOrmTransactionContext;
  helper: TypeOrmRepositoryHelper;
  unitOfWork: TypeOrmUnitOfWork;
  tenantId: string;
  companyId: string;
  /** A `live` company of the same tenant. */
  liveCompanyId: string;
  close(): Promise<void>;
}

/**
 * A private schema migrated up to date, a restricted runtime role (RLS applies) and one tenant
 * with one `test` company. Everything is dropped by `close()`.
 */
export async function createPostgresHarness(
  prefix: string,
): Promise<PostgresHarness> {
  const url = migrationTestUrl;
  if (!url) throw new Error('Test database URL is required');
  const schema = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const role = `${schema}_runtime`;
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const liveCompanyId = randomUUID();
  const admin = new DataSource(
    createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
  );
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.runMigrations();
  await admin.query(
    `INSERT INTO "${schema}".plans (id,slug,name,monthly_credit_allowance,credit_unit_price_cents,daily_limit) VALUES ($1,'free','Free',100,0,NULL) ON CONFLICT (slug) DO NOTHING`,
    [randomUUID()],
  );
  await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
    tenantId,
  ]);
  for (const [id, environment] of [
    [companyId, 'test'],
    [liveCompanyId, 'live'],
  ])
    await admin.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181',$3)`,
      [id, tenantId, environment],
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
  const runtimeUrl = new URL(url);
  runtimeUrl.username = role;
  runtimeUrl.password = password;
  const options = createTypeOrmOptions({
    url: runtimeUrl.toString(),
    schema,
    ssl: false,
    logging: false,
  });
  const runtime = new DataSource({
    ...options,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pool options are typed `any`
    extra: { ...options.extra, max: 6 },
  });
  await runtime.initialize();
  installRlsConnectionScope(runtime);
  const transactions = new TypeOrmTransactionContext();
  return {
    schema,
    admin,
    runtime,
    transactions,
    helper: new TypeOrmRepositoryHelper(runtime, transactions),
    unitOfWork: new TypeOrmUnitOfWork(runtime, transactions),
    tenantId,
    companyId,
    liveCompanyId,
    async close() {
      if (runtime.isInitialized) await runtime.destroy();
      if (admin.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        await admin.destroy();
      }
    },
  };
}
