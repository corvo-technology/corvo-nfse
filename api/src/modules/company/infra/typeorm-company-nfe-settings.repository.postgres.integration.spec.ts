import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { NfeSettingsInput } from '../domain/nfe-settings';
import { TypeOrmCompanyNfeSettingsRepository } from './typeorm-company-nfe-settings.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_settings_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();

const input = (
  overrides: Partial<Required<NfeSettingsInput>> = {},
): Required<NfeSettingsInput> => ({
  stateRegistration: '110042490114',
  crt: 1,
  defaultSeries: 1,
  nfceDefaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  ...overrides,
});

describePostgres(
  'company NF-e settings repository with a restricted PostgreSQL role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repo: TypeOrmCompanyNfeSettingsRepository;

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
      repo = new TypeOrmCompanyNfeSettingsRepository(
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

    it('has no settings before the first save', async () => {
      expect(await repo.find(companyA, tenantA)).toBeNull();
    });

    it('creates and then updates the settings, keeping a single row', async () => {
      const created = await repo.upsert(companyA, tenantA, input());
      expect(created).toMatchObject({
        companyId: companyA,
        stateRegistration: '110042490114',
        crt: 1,
        defaultCsosn: '102',
        nfceDefaultSeries: 1,
      });
      const updated = await repo.upsert(
        companyA,
        tenantA,
        input({
          crt: 4,
          defaultCsosn: '400',
          defaultSeries: 2,
          nfceDefaultSeries: 6,
        }),
      );
      expect(updated).toMatchObject({
        crt: 4,
        defaultCsosn: '400',
        defaultSeries: 2,
        nfceDefaultSeries: 6,
      });
      const [{ count }]: Array<{ count: string }> = await admin.query(
        `SELECT count(*)::text AS count FROM "${schema}".company_nfe_settings WHERE company_id=$1`,
        [companyA],
      );
      expect(count).toBe('1');
    });

    it('does not touch the reserved columns on update', async () => {
      await admin.query(
        `UPDATE "${schema}".company_nfe_settings SET nfce_csc_id='000001', nfce_csc_encrypted='enc' WHERE company_id=$1`,
        [companyA],
      );
      await repo.upsert(companyA, tenantA, input({ defaultSeries: 3 }));
      const [row]: Array<{ id: string; enc: string; mode: string }> =
        await admin.query(
          `SELECT nfce_csc_id AS id, nfce_csc_encrypted AS enc, contingency_mode AS mode FROM "${schema}".company_nfe_settings WHERE company_id=$1`,
          [companyA],
        );
      expect(row).toEqual({ id: '000001', enc: 'enc', mode: 'none' });
    });

    it("does not show one tenant's settings to another tenant", async () => {
      expect(await repo.find(companyA, tenantB)).toBeNull();
      expect(await repo.find(companyA, tenantA)).not.toBeNull();
    });

    it('refuses settings for a company of another tenant', async () => {
      await expect(
        repo.upsert(companyB, tenantA, input()),
      ).rejects.toBeDefined();
    });

    it('refuses a CRT outside 1 and 4', async () => {
      await expect(
        admin.query(
          `UPDATE "${schema}".company_nfe_settings SET crt=3 WHERE company_id=$1`,
          [companyA],
        ),
      ).rejects.toThrow(/ck_company_nfe_settings_crt/);
    });
  },
);
