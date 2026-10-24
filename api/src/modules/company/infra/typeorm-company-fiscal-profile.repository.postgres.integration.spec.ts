import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import type { NewFiscalProfile } from '../domain/fiscal-profile.repository';
import { CreateCompanyFiscalProfiles1791780000000 } from '@/infra/database/migrations/1791780000000-CreateCompanyFiscalProfiles';
import { TypeOrmCompanyFiscalProfileRepository } from './typeorm-company-fiscal-profile.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `cfp_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID(),
  companyC = randomUUID(),
  companyD = randomUUID();

const profileInput = (
  validFrom: string,
  overrides: Partial<NewFiscalProfile> = {},
): NewFiscalProfile => ({
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
  validFrom,
  source: 'manual',
  reviewStatus: 'unreviewed',
  reviewedBy: null,
  ...overrides,
});

describePostgres(
  'company fiscal profile repository with a restricted PostgreSQL role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repo: TypeOrmCompanyFiscalProfileRepository;
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
        [tenantA, companyC, '11222333000183'],
        [tenantA, companyD, '11222333000184'],
      ] as const) {
        await admin.query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,'test')`,
          [company, tenant, taxId],
        );
      }
      const password = randomBytes(24).toString('hex');
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
      );
      const [owner]: Array<{ role: string }> = await admin.query(
        'SELECT current_user AS role',
      );
      if (!owner) throw new Error('Migration owner was not returned');
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
      repo = new TypeOrmCompanyFiscalProfileRepository(
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

    it('creates the first profile', async () => {
      const created = await repo.append(
        companyA,
        tenantA,
        profileInput('2026-01-01'),
      );
      expect(created.validFrom).toBe('2026-01-01');
      expect(created.validUntil).toBeNull();
      expect(created.reviewStatus).toBe('unreviewed');
      const open = await repo.findOpen(companyA, tenantA);
      expect(open?.id).toBe(created.id);
      expect(open?.validFrom).toBe('2026-01-01');
    });

    it('closes the open profile when a later one starts', async () => {
      // Re-appending the same day rewrites the still-unreviewed profile in place.
      await repo.append(companyA, tenantA, profileInput('2026-01-01'));
      const second = await repo.append(
        companyA,
        tenantA,
        profileInput('2026-06-01'),
      );
      const profiles = await repo.list(companyA, tenantA);
      expect(profiles).toHaveLength(2);
      const [later, earlier] = profiles;
      expect(later?.validFrom).toBe('2026-06-01');
      expect(later?.validUntil).toBeNull();
      expect(earlier?.validFrom).toBe('2026-01-01');
      expect(earlier?.validUntil).toBe('2026-06-01');
      expect(second.validFrom).toBe('2026-06-01');
    });

    it('findEffective picks the profile valid on the date', async () => {
      const onMay = await repo.findEffective(companyA, tenantA, '2026-05-31');
      expect(onMay?.validFrom).toBe('2026-01-01');
      expect(onMay?.validUntil).toBe('2026-06-01');
      const onJune = await repo.findEffective(companyA, tenantA, '2026-06-01');
      expect(onJune?.validFrom).toBe('2026-06-01');
      expect(onJune?.validUntil).toBeNull();
    });

    it('findEffective returns null before the first profile', async () => {
      expect(
        await repo.findEffective(companyA, tenantA, '2025-12-31'),
      ).toBeNull();
    });

    it('updates in place when the same day is rewritten and the profile is not approved', async () => {
      const openBefore = await repo.findOpen(companyA, tenantA);
      expect(openBefore).not.toBeNull();
      await repo.append(
        companyA,
        tenantA,
        profileInput('2026-06-01', {
          taxRegime: 'LUCRO_REAL',
          simpleNational: false,
        }),
      );
      const openAfter = await repo.findOpen(companyA, tenantA);
      expect(openAfter?.id).toBe(openBefore?.id);
      expect(openAfter?.taxRegime).toBe('LUCRO_REAL');
      expect(openAfter?.simpleNational).toBe(false);
      expect(await repo.list(companyA, tenantA)).toHaveLength(2);
    });

    it('refuses to rewrite an approved profile on the same day', async () => {
      const open = await repo.findOpen(companyA, tenantA);
      if (!open) throw new Error('Expected an open profile');
      await repo.markApproved(
        open.id,
        tenantA,
        'reviewer@example.invalid',
        new Date(),
      );
      await expect(
        repo.append(companyA, tenantA, profileInput('2026-06-01')),
      ).rejects.toThrow(ConflictException);
      await expect(
        repo.append(companyA, tenantA, profileInput('2026-06-01')),
      ).rejects.toThrow('profile_validity_conflict');
    });

    it('refuses a profile starting before the current one', async () => {
      await expect(
        repo.append(companyA, tenantA, profileInput('2026-05-01')),
      ).rejects.toMatchObject({
        name: 'FiscalValidationError',
        issues: [
          expect.objectContaining({ field: 'validFrom', code: 'invalid' }),
        ],
      });
      await expect(
        repo.append(companyA, tenantA, profileInput('2026-05-01')),
      ).rejects.toBeInstanceOf(FiscalValidationError);
      expect(await repo.list(companyA, tenantA)).toHaveLength(2);
    });

    it('lets a company registered today start its fiscal profile in the past', async () => {
      // The profile created at registration starts today (24/10)...
      await repo.append(companyD, tenantA, profileInput('2026-10-24'));
      // ...but the company already existed, so an invoice for September must work.
      const retroactive = await repo.append(
        companyD,
        tenantA,
        profileInput('2026-01-01', {
          reviewStatus: 'approved',
          reviewedBy: 'api-key',
        }),
      );

      expect(retroactive.validFrom).toBe('2026-01-01');
      expect(retroactive.validUntil).toBe('2026-10-24');
      expect(retroactive.reviewStatus).toBe('approved');
      const [current, earlier] = await repo.list(companyD, tenantA);
      expect(current?.validFrom).toBe('2026-10-24');
      expect(current?.validUntil).toBeNull();
      expect(earlier?.id).toBe(retroactive.id);
      // Still exactly one open profile.
      expect(
        (await repo.list(companyD, tenantA)).filter(
          (p) => p.validUntil === null,
        ),
      ).toHaveLength(1);
      // The invoice of 30/09 now finds its profile; before it, nothing was effective.
      expect(
        (await repo.findEffective(companyD, tenantA, '2026-09-30'))?.id,
      ).toBe(retroactive.id);
      expect(
        await repo.findEffective(companyD, tenantA, '2025-12-31'),
      ).toBeNull();
    });

    it('refuses a retroactive start that lands inside the existing history, or on its first day', async () => {
      // companyD now covers 2026-01-01 onwards without gaps.
      for (const validFrom of ['2026-01-01', '2026-05-01'])
        await expect(
          repo.append(companyD, tenantA, profileInput(validFrom)),
        ).rejects.toBeInstanceOf(FiscalValidationError);
      expect(await repo.list(companyD, tenantA)).toHaveLength(2);
    });

    it('only one open profile per company (unique index)', async () => {
      const [first, second] = await Promise.all([
        repo.append(companyC, tenantA, profileInput('2026-01-01')),
        repo.append(companyC, tenantA, profileInput('2026-01-01')),
      ]);
      expect(first.validFrom).toBe('2026-01-01');
      expect(second.validFrom).toBe('2026-01-01');
      expect(first.id).toBe(second.id);
      const profiles = await repo.list(companyC, tenantA);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.validUntil).toBeNull();
    });

    it('RLS hides profiles from another tenant', async () => {
      const rows = await runWithTenant(tenantB, () =>
        runtime.query(
          `SELECT id FROM "${schema}".company_fiscal_profiles WHERE tenant_id=$1`,
          [tenantA],
        ),
      );
      expect(rows).toEqual([]);
      expect(
        await repo.findEffective(companyA, tenantB, '2026-06-01'),
      ).toBeNull();
      await expect(
        repo.append(companyA, tenantB, profileInput('2027-01-01')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('copies legacy company fiscal data when the migration runs on existing companies', async () => {
      const runner = admin.createQueryRunner();
      const migration = new CreateCompanyFiscalProfiles1791780000000();
      try {
        await migration.down(runner);
        await migration.up(runner);
      } finally {
        await runner.release();
      }
      const rows: Array<{
        tax_regime: string;
        valid_from: string;
        source: string;
        review_status: string;
      }> = await admin.query(
        `SELECT tax_regime, valid_from::text AS valid_from, source, review_status FROM "${schema}".company_fiscal_profiles WHERE company_id=$1`,
        [companyA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        tax_regime: 'MEI',
        valid_from: expect.any(String),
        source: 'company_legacy',
        review_status: 'unreviewed',
      });
      const [companyRow]: Array<{ createdAt: string }> = await admin.query(
        `SELECT created_at::text AS "createdAt" FROM "${schema}".nfse_companies WHERE id=$1`,
        [companyA],
      );
      expect(companyRow?.createdAt.slice(0, 10)).toBe(rows[0]?.valid_from);
    });
  },
);
