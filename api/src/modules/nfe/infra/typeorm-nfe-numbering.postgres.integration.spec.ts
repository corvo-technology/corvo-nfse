import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { NumberingScope } from '@/modules/fiscal-core/domain/ports/numbering.port';
import { NfeNumberingExhaustedError } from '../domain/errors';
import { TypeormNfeNumbering } from './typeorm-nfe-numbering';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('NF-e numbering tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_num_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenant = randomUUID();
const company = randomUUID();

const scope = (series = 1, model: 55 | 65 = 55): NumberingScope => ({
  companyId: company,
  tenantId: tenant,
  environment: 'test',
  model,
  series,
});

describePostgres('NF-e numbering with real PostgreSQL', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let numbering: TypeormNfeNumbering;
  const transactions = new TypeOrmTransactionContext();

  /** The write-ahead transaction of the caller. */
  const inTransaction = <T>(work: () => Promise<T>) =>
    runWithTenant(tenant, () =>
      runtime.transaction((manager) => transactions.run(manager, work)),
    );

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
    await admin.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
      [company, tenant],
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
    runtime = new DataSource({
      ...options,
      extra: { ...options.extra, max: 25 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    numbering = new TypeormNfeNumbering(
      new TypeOrmRepositoryHelper(runtime, transactions),
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

  it('starts at 1 and counts per series', async () => {
    expect(await inTransaction(() => numbering.reserveNext(scope(7)))).toEqual({
      series: 7,
      number: 1,
    });
    expect(await inTransaction(() => numbering.reserveNext(scope(7)))).toEqual({
      series: 7,
      number: 2,
    });
    expect(await inTransaction(() => numbering.reserveNext(scope(8)))).toEqual({
      series: 8,
      number: 1,
    });
  });

  it('counts the NF-e (55) and the NFC-e (65) of the same series apart', async () => {
    const a = await inTransaction(() => numbering.reserveNext(scope(31, 55)));
    const b = await inTransaction(() => numbering.reserveNext(scope(31, 65)));
    const c = await inTransaction(() => numbering.reserveNext(scope(31, 65)));
    expect([a.number, b.number, c.number]).toEqual([1, 1, 2]);
  });

  it('gives 1..20 without repeating to 20 concurrent reservations', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        inTransaction(() => numbering.reserveNext(scope(2))),
      ),
    );
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('does not consume the number when the transaction rolls back', async () => {
    await expect(
      inTransaction(async () => {
        await numbering.reserveNext(scope(3));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await inTransaction(() => numbering.reserveNext(scope(3)))).toEqual({
      series: 3,
      number: 1,
    });
  });

  it('raiseTo moves forward only', async () => {
    await inTransaction(() => numbering.reserveNext(scope(4)));
    await inTransaction(() => numbering.reserveNext(scope(4)));
    await inTransaction(() => numbering.raiseTo(scope(4), 5));
    expect(await inTransaction(() => numbering.reserveNext(scope(4)))).toEqual({
      series: 4,
      number: 6,
    });
    await inTransaction(() => numbering.raiseTo(scope(4), 1));
    expect(await inTransaction(() => numbering.reserveNext(scope(4)))).toEqual({
      series: 4,
      number: 7,
    });
  });

  it('raiseTo creates the sequence when there is none', async () => {
    await inTransaction(() => numbering.raiseTo(scope(5), 10));
    expect(await inTransaction(() => numbering.reserveNext(scope(5)))).toEqual({
      series: 5,
      number: 11,
    });
  });

  it('peekNext reads the next number without reserving it', async () => {
    expect(await inTransaction(() => numbering.peekNext(scope(9)))).toEqual({
      series: 9,
      number: 1,
    });
    await inTransaction(() => numbering.raiseTo(scope(9), 41));
    expect(await inTransaction(() => numbering.peekNext(scope(9)))).toEqual({
      series: 9,
      number: 42,
    });
    expect(await inTransaction(() => numbering.peekNext(scope(9)))).toEqual({
      series: 9,
      number: 42,
    });
    expect(await inTransaction(() => numbering.reserveNext(scope(9)))).toEqual({
      series: 9,
      number: 42,
    });
  });

  it('refuses to go past 999999999', async () => {
    await inTransaction(() => numbering.raiseTo(scope(6), 999_999_999));
    await expect(
      inTransaction(() => numbering.reserveNext(scope(6))),
    ).rejects.toBeInstanceOf(NfeNumberingExhaustedError);
  });
});
