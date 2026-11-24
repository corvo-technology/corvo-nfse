import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmAccountantPackageRepository } from './typeorm-accountant-package.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `apsend_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();

describePostgres('accountant_package_sends (RLS integration)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repository: TypeOrmAccountantPackageRepository;
  const table = (name: string) => `"${schema}"."${name}"`;

  beforeAll(async () => {
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test'),($3,$4,'Other','11222333000182','test')`,
      [companyA, tenantA, companyB, tenantB],
    );
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    for (let index = 0; index < 2; index++)
      execFileSync(
        'psql',
        [
          url!,
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
    const runtimeUrl = new URL(url!);
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
      extra: { ...options.extra, max: 1 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    await new RlsConnectionScopeService(runtime).onModuleInit();
    repository = new TypeOrmAccountantPackageRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
  }, 60000);

  afterEach(async () => {
    await admin.query(`DELETE FROM ${table('accountant_package_sends')}`);
  });

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  const entry = (tenantId: string, companyId: string, month = '2026-10') => ({
    tenantId,
    companyId,
    month,
    recipient: 'contador@example.com',
    invoiceCount: 42,
    totalCents: 1234500,
    status: 'sent' as const,
    trigger: 'scheduled' as const,
  });

  it('records attempts and lists them newest first, limited', async () => {
    await repository.recordSend(entry(tenantA, companyA, '2026-08'));
    await repository.recordSend(entry(tenantA, companyA, '2026-09'));
    await repository.recordSend(entry(tenantA, companyA, '2026-10'));
    const rows = await repository.listSends(tenantA, companyA, 2);
    expect(rows.map((row) => row.month)).toEqual(['2026-10', '2026-09']);
    expect(rows[0]).toMatchObject({
      recipient: 'contador@example.com',
      invoiceCount: 42,
      totalCents: 1234500,
      status: 'sent',
      trigger: 'scheduled',
    });
    await expect(
      repository.hasSend(tenantA, companyA, '2026-10', 'sent'),
    ).resolves.toBe(true);
    await expect(
      repository.hasSend(tenantA, companyA, '2026-10', 'skipped-empty'),
    ).resolves.toBe(false);
  });

  it('never shows or writes another tenant history', async () => {
    await repository.recordSend(entry(tenantB, companyB));
    await expect(repository.listSends(tenantA, companyB, 12)).resolves.toEqual(
      [],
    );
    await expect(
      repository.listSends(tenantB, companyB, 12),
    ).resolves.toHaveLength(1);
    await expect(
      repository.hasSend(tenantA, companyB, '2026-10', 'sent'),
    ).resolves.toBe(false);
  });

  it('rejects raw SQL that reads or writes across tenants through the runtime role', async () => {
    await repository.recordSend(entry(tenantB, companyB));
    await runWithTenant(tenantA, async () => {
      const rows: unknown[] = await runtime.query(
        `SELECT id FROM ${table('accountant_package_sends')}`,
      );
      expect(rows).toEqual([]);
      await expect(
        runtime.query(
          `INSERT INTO ${table('accountant_package_sends')} (tenant_id,company_id,month,recipient,status,trigger) VALUES ($1,$2,'2026-10','x@y.com','sent','manual')`,
          [tenantB, companyB],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    });
  });

  it('refuses a status or trigger outside the allowed list', async () => {
    await expect(
      admin.query(
        `INSERT INTO ${table('accountant_package_sends')} (tenant_id,company_id,month,recipient,status,trigger) VALUES ($1,$2,'2026-10','x@y.com','bogus','manual')`,
        [tenantA, companyA],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
});
