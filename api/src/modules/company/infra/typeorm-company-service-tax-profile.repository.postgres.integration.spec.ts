import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { NewServiceTaxProfile } from '../domain/service-tax-profile.repository';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { TypeOrmCompanyServiceTaxProfileRepository } from './typeorm-company-service-tax-profile.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `cstp_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();

const serviceProfileInput = (
  overrides: Partial<NewServiceTaxProfile> = {},
): NewServiceTaxProfile => ({
  name: 'Limpeza predial',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  operationNature: 'SERVICE',
  regimeApplicability: ['SIMPLES_NACIONAL'],
  incidenceMunicipalityCode: null,
  issTaxation: 'NORMAL',
  issRate: '3.5',
  issWithholdingDefault: false,
  withholdingPolicy: 'UNKNOWN',
  withholdingRates: {},
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'unreviewed',
  catalogVersion: null,
  ...overrides,
});

describePostgres(
  'TypeOrmCompanyServiceTaxProfileRepository (RLS integration)',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repository: TypeOrmCompanyServiceTaxProfileRepository;
    const table = (name: string) => `"${schema}"."${name}"`;
    beforeAll(async () => {
      admin = new DataSource(
        createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
      );
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.runMigrations();
      await admin.query(
        `INSERT INTO ${table('tenants')} (id) VALUES ($1),($2)`,
        [tenantA, tenantB],
      );
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
      repository = new TypeOrmCompanyServiceTaxProfileRepository(runtime);
    }, 60000);
    afterAll(async () => {
      if (runtime?.isInitialized) await runtime.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        await admin.destroy();
      }
    });

    it('round-trips a profile with text[] regimes, jsonb rates and numeric as string', async () => {
      const created = await repository.upsert(
        null,
        companyA,
        tenantA,
        serviceProfileInput({
          regimeApplicability: ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO'],
          withholdingPolicy: 'CONFIGURED',
          withholdingRates: { irrf: '1.5', inss: '11' },
        }),
      );

      expect(created.id).toEqual(expect.any(String));
      expect(created.tenantId).toBe(tenantA);
      expect(created.companyId).toBe(companyA);
      expect(created.regimeApplicability).toEqual([
        'SIMPLES_NACIONAL',
        'LUCRO_PRESUMIDO',
      ]);
      expect(created.withholdingRates).toEqual({ irrf: '1.5', inss: '11' });
      expect(created.issRate).toBe('3.50000');
      expect(created.reviewStatus).toBe('unreviewed');
      expect(created.createdAt).toBeInstanceOf(Date);

      await expect(
        repository.findById(created.id, companyA, tenantA),
      ).resolves.toEqual(created);
    });

    it('effective queries respect the inclusive-from exclusive-until boundaries', async () => {
      const first = await repository.upsert(
        null,
        companyA,
        tenantA,
        serviceProfileInput({ effectiveUntil: '2026-06-01' }),
      );
      const second = await repository.upsert(
        null,
        companyA,
        tenantA,
        serviceProfileInput({ effectiveFrom: '2026-06-01' }),
      );

      const before = await repository.findEffectiveByCompanyAndCode(
        companyA,
        tenantA,
        '010101',
        '2025-12-31',
      );
      expect(before).toEqual([]);

      const onFirstDay = await repository.findEffectiveByCompanyAndCode(
        companyA,
        tenantA,
        '010101',
        '2026-01-01',
      );
      expect(onFirstDay.map((row) => row.id)).toEqual([first.id]);

      const lastDay = await repository.findEffectiveByCompanyAndCode(
        companyA,
        tenantA,
        '010101',
        '2026-05-31',
      );
      expect(lastDay.map((row) => row.id)).toEqual([first.id]);

      const handover = await repository.findEffectiveByCompanyAndCode(
        companyA,
        tenantA,
        '010101',
        '2026-06-01',
      );
      expect(handover.map((row) => row.id)).toEqual([second.id]);
    });

    it('returns every effective candidate and leaves ambiguity to the engine', async () => {
      const one = await repository.upsert(
        null,
        companyB,
        tenantB,
        serviceProfileInput(),
      );
      const two = await repository.upsert(
        null,
        companyB,
        tenantB,
        serviceProfileInput({ name: 'Duplicada' }),
      );

      const candidates = await repository.findEffectiveByCompanyAndCode(
        companyB,
        tenantB,
        '010101',
        '2026-02-01',
      );
      expect(candidates.map((row) => row.id).sort()).toEqual(
        [one.id, two.id].sort(),
      );
    });

    it('updates a row in place without creating a new version', async () => {
      const created = await repository.upsert(
        null,
        companyB,
        tenantB,
        serviceProfileInput(),
      );
      const updated = await repository.upsert(
        created.id,
        companyB,
        tenantB,
        serviceProfileInput({ name: 'Revisada', issRate: '4.25' }),
      );

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Revisada');
      expect(updated.issRate).toBe('4.25000');
      await expect(
        repository.findEffectiveByCompany(companyB, tenantB, '2026-02-01'),
      ).resolves.toEqual([expect.objectContaining({ id: created.id })]);

      await expect(
        repository.upsert(
          randomUUID(),
          companyB,
          tenantB,
          serviceProfileInput(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes reads by tenant and company', async () => {
      const created = await repository.upsert(
        null,
        companyA,
        tenantA,
        serviceProfileInput(),
      );

      await expect(
        repository.findById(created.id, companyB, tenantA),
      ).resolves.toBeNull();
      await expect(
        repository.findById(created.id, companyA, tenantB),
      ).resolves.toBeNull();
      expect(
        await repository.findEffectiveByCompany(
          companyB,
          tenantA,
          '2026-02-01',
        ),
      ).toEqual([]);
      expect(
        await repository.findEffectiveByCompanyAndCode(
          companyB,
          tenantB,
          '010101',
          '2026-02-01',
        ),
      ).not.toContainEqual(expect.objectContaining({ id: created.id }));
    });

    it('deletes only rows of the scoped tenant and company', async () => {
      const created = await repository.upsert(
        null,
        companyA,
        tenantA,
        serviceProfileInput(),
      );

      await expect(
        repository.delete(created.id, companyA, tenantB),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        repository.findById(created.id, companyA, tenantA),
      ).resolves.not.toBeNull();

      await repository.delete(created.id, companyA, tenantA);
      await expect(
        repository.findById(created.id, companyA, tenantA),
      ).resolves.toBeNull();
    });

    it('rejects raw SQL writes that claim another tenant through the runtime role', async () => {
      await runWithTenant(tenantA, async () => {
        await expect(
          runtime.query(
            `INSERT INTO ${table('company_service_tax_profiles')} (tenant_id,company_id,name,service_code,effective_from,classification_source) VALUES ($1,$2,'Intruder','010101','2026-01-01','manual')`,
            [tenantB, companyA],
          ),
        ).rejects.toMatchObject({ driverError: { code: '42501' } });
      });
    });
  },
);
