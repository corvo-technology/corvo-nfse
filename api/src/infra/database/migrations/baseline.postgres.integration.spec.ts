import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { createTypeOrmOptions } from '../typeorm.options';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import {
  AuthUserOrmEntity,
  AuthSessionOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';
import { TypeOrmPlanRepository } from '@/modules/plans/infra/typeorm-plan.repository';
import { TypeOrmTenantPlanRepository } from '@/modules/plans/infra/typeorm-tenant-plan.repository';
import { TenantPlanService } from '@/modules/plans/application/tenant-plan.service';
import { PlanSeederService } from '@/modules/plans/application/plan-seeder.service';
import { FreeAbuseChecker } from '@/modules/plans/application/free-abuse-checker.service';
import { FreeAbuseDetectedError } from '@/modules/plans/domain/free-abuse-detected.error';
import { TurnstileVerificationService } from '@/modules/security/application/turnstile-verification.service';
import { TypeOrmTenantRepository } from '@/modules/auth/infra/typeorm-tenant.repository';
import { TypeOrmAuthIdentityRepository } from '@/modules/auth/infra/typeorm-auth-identity.repository';
import { AuthIdentity } from '@/modules/auth/domain/auth-identity';
import { Company } from '@/modules/company/domain/company';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { TypeOrmCompanyRepository } from '@/modules/company/infra/typeorm-company.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
// Each run owns a schema. No shared application schema is dropped or truncated.
const schema = `CorvoBaseline_${randomUUID().replaceAll('-', '')}`;

if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  ) {
    throw new Error(
      'MIGRATION_TEST_DATABASE_URL must point to a local database ending in _test',
    );
  }
}

describePostgres('Corvo baseline PostgreSQL integration', () => {
  let db: DataSource;
  let plans: TypeOrmPlanRepository;
  let assignments: TypeOrmTenantPlanRepository;
  let service: TenantPlanService;
  let checker: FreeAbuseChecker;

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    const migrations = await db.runMigrations();
    expect(migrations[0].name).toBe('InitialCorvoBaseline1791574778928');
    expect(migrations.map((migration) => migration.timestamp)).toEqual(
      [...migrations.map((migration) => migration.timestamp)].sort(
        (a, b) => a - b,
      ),
    );
    expect(migrations.map((migration) => migration.name)).toContain(
      'McpoauthServerBaseline1791590400000',
    );
    expect(migrations.map((m) => m.name)).toEqual(
      expect.arrayContaining([
        'InitialCorvoBaseline1791574778928',
        'AddDocumentsReadyAndEmailStateToInvoices1791575000000',
        'SeparateFiscalEnvironments1791589200000',
      ]),
    );
    plans = new TypeOrmPlanRepository(
      db.getRepository(PlanOrmEntity),
      db.getRepository(TenantOrmEntity),
    );
    assignments = new TypeOrmTenantPlanRepository(
      db.getRepository(TenantOrmEntity),
      db.getRepository(TenantBillingOrmEntity),
      plans,
    );
    service = new TenantPlanService(
      new TenantWorkDiscovery(db),
      assignments,
      plans,
    );
    checker = new FreeAbuseChecker(
      assignments,
      new TurnstileVerificationService(new ConfigService()),
    );
    await Promise.all([
      new PlanSeederService(plans).seedIfMissing(),
      new PlanSeederService(plans).seedIfMissing(),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('creates the entire current schema without legacy tables or entity drift', async () => {
    const rows = await db.query<Array<{ tablename: string }>>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      [schema],
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual(
      [...db.entityMetadatas.map((m) => m.tableName), 'migrations'].sort(),
    );
    expect(db.entityMetadatas).toHaveLength(26);
    const diff = await db.driver.createSchemaBuilder().log();
    expect(diff.upQueries.map((q) => q.query)).toEqual([]);
    expect(await db.runMigrations()).toEqual([]);
    await new PlanSeederService(plans).seedIfMissing();
    expect(await plans.findAll()).toHaveLength(5);
  });

  it('persists plan upgrades, billing periods and scheduled downgrades through real repositories', async () => {
    const tenantId = randomUUID();
    const tenants = new TypeOrmTenantRepository(
      db.getRepository(TenantOrmEntity),
    );
    await tenants.createIfNotExists(tenantId);
    await tenants.createIfNotExists(tenantId);
    expect((await plans.findActiveByTenantId(tenantId))?.slug).toBe('free');
    const free = await service.getOrCreate(tenantId);
    expect(free.plan.slug).toBe('free');
    const upgraded = await service.upgradePlan(tenantId, 'dev');
    expect(upgraded.plan.slug).toBe('dev');
    expect((await plans.findActiveByTenantId(tenantId))?.slug).toBe(
      'dev',
    );
    const scheduled = await service.scheduleDowngrade(tenantId, 'free');
    expect(scheduled.downgradeToPlanId).toBe(free.plan.id);
    await assignments.updatePeriod(
      tenantId,
      new Date('2020-01-01'),
      new Date('2020-02-01'),
    );
    await service.applyScheduledDowngrades();
    const renewed = await assignments.findByTenantId(tenantId);
    expect(renewed?.plan.slug).toBe('free');
    expect(renewed?.downgradeToPlanId).toBeNull();
    expect(renewed?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it('detects free billing reuse, permits paid billing reuse and honors the null-plan free fallback', async () => {
    const email = `billing-${randomUUID()}@example.com`;
    const taxId = '12345678000199';
    const tenantId = randomUUID();
    await service.getOrCreate(tenantId);
    await assignments.setBillingInfo(tenantId, email.toUpperCase(), taxId);
    await expect(
      checker.assertEmailNotInFreeWorkspace(email),
    ).rejects.toBeInstanceOf(FreeAbuseDetectedError);
    await expect(
      checker.assertTaxIdNotInFreeWorkspace(taxId),
    ).rejects.toBeInstanceOf(FreeAbuseDetectedError);
    await service.upgradePlan(tenantId, 'dev');
    await expect(
      checker.assertEmailNotInFreeWorkspace(email),
    ).resolves.toBeUndefined();
    await expect(
      checker.assertTaxIdNotInFreeWorkspace(taxId),
    ).resolves.toBeUndefined();
    const paidId = randomUUID();
    await service.getOrCreate(paidId);
    await service.upgradePlan(paidId, 'pro');
    await expect(
      assignments.setBillingInfo(paidId, email, taxId),
    ).resolves.toBeUndefined();
    await db.getRepository(TenantOrmEntity).update(tenantId, { planId: null });
    await expect(
      checker.assertEmailNotInFreeWorkspace(email),
    ).rejects.toBeInstanceOf(FreeAbuseDetectedError);
    await expect(
      checker.assertTaxIdNotInFreeWorkspace(taxId),
    ).rejects.toBeInstanceOf(FreeAbuseDetectedError);
  });

  it('seeds the current session client and enforces session, identity and tenant integrity', async () => {
    const userId = randomUUID();
    await db.getRepository(AuthUserOrmEntity).insert({
      id: userId,
      email: `${userId}@example.com`,
      name: 'Baseline user',
    });
    await db.getRepository(AuthSessionOrmEntity).insert({
      id: randomUUID(),
      authUserId: userId,
      kind: 'web',
      sessionTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      db.getRepository(AuthSessionOrmEntity).insert({
        id: randomUUID(),
        authUserId: userId,
        kind: 'web',
        sessionTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      db.getRepository(AuthSessionOrmEntity).insert({
        id: randomUUID(),
        authUserId: randomUUID(),
        kind: 'web',
        sessionTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    const identities = new TypeOrmAuthIdentityRepository(
      db.getRepository('AuthIdentityOrmEntity'),
    );
    const input = {
      authUserId: userId,
      provider: 'google' as const,
      providerUserId: randomUUID(),
      email: `${userId}@example.com`,
      emailVerified: true,
      name: null,
      avatarUrl: null,
    };
    const identity = await identities.save(AuthIdentity.create(input));
    expect(
      (
        await identities.findByProviderAndProviderUserId(
          'google',
          input.providerUserId,
        )
      )?.id,
    ).toBe(identity.id);
    await expect(
      identities.save(AuthIdentity.create(input)),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      db
        .getRepository(TenantOrmEntity)
        .insert({ id: randomUUID(), planId: randomUUID() }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('persists, changes and clears company defaults with tenant and environment isolation', async () => {
    const tenantId = randomUUID();
    await new TypeOrmTenantRepository(
      db.getRepository(TenantOrmEntity),
    ).createIfNotExists(tenantId);
    const companies = new TypeOrmCompanyRepository(
      db.getRepository(CompanyOrmEntity),
    );
    const company = Company.create(
      {
        legalName: 'Defaults',
        taxId: '11222333000181',
        taxRegime: 'MEI',
        municipalityCode: '3550308',
        defaultServiceCode: '010101',
      },
      tenantId,
    );
    await companies.save(company, tenantId);
    expect(
      (await companies.findByIdAndTenantId(company.id, tenantId, 'test'))
        ?.defaultServiceCode,
    ).toBe('010101');
    expect(
      await companies.findByIdAndTenantId(company.id, randomUUID(), 'test'),
    ).toBeNull();
    expect(
      await companies.findByIdAndTenantId(company.id, tenantId, 'live'),
    ).toBeNull();
    company.update({ defaultServiceCode: '010201' });
    await companies.save(company, tenantId);
    expect(
      (await companies.findByTaxIdAndTenantId(company.taxId, tenantId, 'test'))
        ?.defaultServiceCode,
    ).toBe('010201');
    company.update({ defaultServiceCode: null });
    await companies.save(company, tenantId);
    expect(
      (await companies.findByIdAndTenantId(company.id, tenantId, 'test'))
        ?.defaultServiceCode,
    ).toBeUndefined();
    const rows = await db.query<Array<{ default_service_code: string | null }>>(
      `SELECT default_service_code FROM "${schema}".nfse_companies WHERE id = $1`,
      [company.id],
    );
    expect(rows[0].default_service_code).toBeNull();
  });

  it('reverts and reapplies the last migration without touching other schemas', async () => {
    await db.undoLastMigration();
    await db.undoLastMigration();
    await db.undoLastMigration();
    const tenantId = randomUUID();
    await new TypeOrmTenantRepository(
      db.getRepository(TenantOrmEntity),
    ).createIfNotExists(tenantId);
    const readyId = randomUUID();
    const blockedId = randomUUID();
    for (const [id, status, taxId] of [
      [readyId, 'ready', '11222333000181'],
      [blockedId, 'blocked', '22334455000186'],
    ]) {
      await db.query(
        `INSERT INTO "${schema}".nfse_companies(id, tenant_id, legal_name, tax_id, tax_regime, status) VALUES ($1, $2, 'Legacy', $3, 'MEI', $4)`,
        [id, tenantId, taxId, status],
      );
    }
    const tables = await db.query<Array<{ tablename: string }>>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      [schema],
    );
    expect(tables.map((t) => t.tablename).sort()).toEqual(
      [
        ...db.entityMetadatas
          .map((m) => m.tableName)
          .filter(
            (name) =>
              name !== 'outbox_messages' && name !== 'company_fiscal_profiles',
          ),
        'migrations',
      ].sort(),
    );
    expect(await db.showMigrations()).toBe(true);
    expect(await db.runMigrations()).toHaveLength(3);
    const legacy = await db.query(
      `SELECT id, status, municipality_code, default_service_code FROM "${schema}".nfse_companies WHERE id IN ($1, $2)`,
      [readyId, blockedId],
    );
    expect(legacy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: readyId,
          status: 'pending_setup',
          municipality_code: null,
          default_service_code: null,
        }),
        expect.objectContaining({
          id: blockedId,
          status: 'blocked',
          municipality_code: null,
          default_service_code: null,
        }),
      ]),
    );
    expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
  });
});
