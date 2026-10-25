import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmSimplesRateRepository } from './typeorm-simples-rate.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `csr_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();

describePostgres(
  'company Simples rates with a restricted PostgreSQL role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repo: TypeOrmSimplesRateRepository;
    beforeAll(async () => {
      if (!url) throw new Error('Test database URL is required');
      admin = new DataSource(
        createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
      );
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.runMigrations();
      await admin.query(
        `INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`,
        [tenantA, tenantB],
      );
      for (const [tenant, company, taxId] of [
        [tenantA, companyA, '11222333000181'],
        [tenantB, companyB, '11222333000182'],
      ] as const)
        await admin.query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,'test')`,
          [company, tenant, taxId],
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
        extra: { ...options.extra, max: 4 },
      });
      await runtime.initialize();
      installRlsConnectionScope(runtime);
      repo = new TypeOrmSimplesRateRepository(
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

    it('upserts a month and replaces the same month', async () => {
      const first = await repo.upsert(companyA, tenantA, '2026-10', {
        totalRate: '6.54',
      });
      expect(first).toMatchObject({ month: '2026-10', totalRate: '6.54' });
      const second = await repo.upsert(companyA, tenantA, '2026-10', {
        totalRate: '7.00',
        issRate: '2.50',
      });
      expect(second).toMatchObject({
        totalRate: '7.00',
        issRate: '2.50',
      });
      expect(await repo.list(companyA, tenantA)).toHaveLength(1);
    });

    it('findAtOrBefore returns the closest month not after the asked one', async () => {
      await repo.upsert(companyA, tenantA, '2026-08', { totalRate: '5.00' });
      expect(
        (await repo.findAtOrBefore(companyA, tenantA, '2026-09'))?.month,
      ).toBe('2026-08');
      expect(
        (await repo.findAtOrBefore(companyA, tenantA, '2026-12'))?.month,
      ).toBe('2026-10');
      expect(
        await repo.findAtOrBefore(companyA, tenantA, '2026-07'),
      ).toBeNull();
    });

    it('list returns the newest month first', async () => {
      const months = (await repo.list(companyA, tenantA)).map((r) => r.month);
      expect(months).toEqual(['2026-10', '2026-08']);
    });

    it('RLS hides the rates from another tenant', async () => {
      expect(await repo.list(companyA, tenantB)).toEqual([]);
      expect(
        await repo.findAtOrBefore(companyA, tenantB, '2026-12'),
      ).toBeNull();
    });

    it('the database refuses an out of range rate and a malformed month', async () => {
      await expect(
        runWithTenant(tenantA, () =>
          runtime.query(
            `INSERT INTO "${schema}".company_simples_rates (tenant_id, company_id, month, total_rate) VALUES ($1,$2,'2026-10',100.01)`,
            [tenantA, companyA],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        runWithTenant(tenantA, () =>
          runtime.query(
            `INSERT INTO "${schema}".company_simples_rates (tenant_id, company_id, month, total_rate) VALUES ($1,$2,'2026-13',5)`,
            [tenantA, companyA],
          ),
        ),
      ).rejects.toThrow();
    });
  },
);
