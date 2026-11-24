import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTenantInvitationRepository } from '@/infra/persistence/typeorm/repositories/tenant-invitation.repository';
import { TypeOrmCompanyFiscalProfileRepository } from '@/modules/company/infra/typeorm-company-fiscal-profile.repository';
import type { NewFiscalProfile } from '@/modules/company/domain/fiscal-profile.repository';
import { TypeOrmCreditTransactionRepository } from '@/modules/credits/infra/typeorm-credit-transaction.repository';
import { TypeOrmCustomerDirectory } from '@/modules/invoice/infra/typeorm-customer-directory';
import { TypeOrmIntegrationConnectionRepository } from '@/modules/integrations/infra/typeorm-integration-connection.repository';
import { IntegrationConnectionOrmEntity } from '@/modules/integrations/infra/integration-connection.orm-entity';
import { InvoiceSchedule } from '@/modules/invoice-schedule/domain/invoice-schedule';
import { TypeOrmInvoiceScheduleRepository } from '@/modules/invoice-schedule/infra/typeorm-invoice-schedule.repository';

/**
 * RLS is switched off here on purpose: the repositories run on the owner
 * (superuser) connection, which Postgres never filters. Every assertion below
 * therefore proves the application predicate alone keeps tenant B's row out of
 * reach of a call made with tenant A's id. The first test proves the bypass.
 */
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pred_test_${randomUUID().replaceAll('-', '')}`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const CNPJ = '11222333000181';
const NOW = new Date('2026-11-06T15:00:00Z');

const profileInput = (validFrom: string): NewFiscalProfile => ({
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
});

describePostgres('tenant predicates with RLS bypassed', () => {
  let db: DataSource;
  const t = (name: string) => `"${schema}"."${name}"`;

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const [tenant, company, taxId] of [
      [tenantA, companyA, '11222333000181'],
      [tenantB, companyB, '11222333000182'],
    ] as const)
      await db.query(
        `INSERT INTO ${t('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,'test')`,
        [company, tenant, taxId],
      );
  }, 60000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('the connection really sees both tenants without any scope (RLS is off)', async () => {
    const [{ count }]: Array<{ count: string }> = await db.query(
      `SELECT count(*) FROM ${t('nfse_companies')}`,
    );
    expect(Number(count)).toBe(2);
  });

  it('customers: tenant A cannot read, update or delete a customer of tenant B', async () => {
    const directory = new TypeOrmCustomerDirectory(db);
    const live = (tenantId: string) => ({
      tenantId,
      environment: 'live' as const,
    });
    await directory.remember(live(tenantB), { taxId: CNPJ, name: 'Acme B' });
    expect(await directory.find(live(tenantA), CNPJ)).toBeNull();
    expect(
      await directory.update(live(tenantA), CNPJ, { name: 'Invasor' }),
    ).toBeNull();
    expect(await directory.remove(live(tenantA), CNPJ)).toBe(false);
    expect((await directory.find(live(tenantB), CNPJ))?.name).toBe('Acme B');
  });

  it('fiscal profiles: tenant A cannot read, approve or append to tenant B', async () => {
    const repo = new TypeOrmCompanyFiscalProfileRepository(
      db,
      new TypeOrmTransactionContext(),
    );
    const own = await repo.append(
      companyB,
      tenantB,
      profileInput('2026-01-01'),
    );
    expect(await repo.findById(own.id, tenantA)).toBeNull();
    expect(await repo.findOpen(companyB, tenantA)).toBeNull();
    expect(await repo.list(companyB, tenantA)).toEqual([]);
    await expect(
      repo.markApproved(own.id, tenantA, 'intruder', new Date()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      repo.append(companyB, tenantA, profileInput('2026-06-01')),
    ).rejects.toBeInstanceOf(NotFoundException);
    const after = await repo.findById(own.id, tenantB);
    expect(after).toMatchObject({
      reviewStatus: 'unreviewed',
      validUntil: null,
    });
    expect(await repo.list(companyB, tenantB)).toHaveLength(1);
    // The right tenant still works: approve, then open a new validity.
    expect(
      (await repo.markApproved(own.id, tenantB, 'owner', new Date()))
        .reviewStatus,
    ).toBe('approved');
    await repo.append(companyB, tenantB, profileInput('2026-06-01'));
    expect(await repo.list(companyB, tenantB)).toHaveLength(2);
  });

  it('invoice schedules: tenant A cannot read or change a schedule of tenant B', async () => {
    const repo = new TypeOrmInvoiceScheduleRepository(
      db,
      new TypeOrmTransactionContext(),
    );
    const created = InvoiceSchedule.create(
      {
        tenantId: tenantB,
        environment: 'live',
        companyId: companyB,
        kind: 'recurring',
        frequency: 'WEEKLY',
        firstOn: '2026-11-09',
        endsOn: null,
        invoiceInput: { amount: 100, customer: { name: 'Ana' } },
        createdBy: 'user-1',
      },
      NOW,
      15,
    );
    await repo.insert(created);
    expect(await repo.findById(created.props.id, tenantA)).toBeNull();
    created.pause();
    await repo.save(
      InvoiceSchedule.restore({ ...created.props, tenantId: tenantA }),
    );
    expect((await repo.findById(created.props.id, tenantB))?.props.status).toBe(
      'active',
    );
  });

  it('credit transactions: tenant A cannot confirm or cancel a reservation of tenant B', async () => {
    const repo = new TypeOrmCreditTransactionRepository(
      new TypeOrmRepositoryHelper(db, new TypeOrmTransactionContext()),
    );
    const reserved = await repo.save(
      {
        tenantId: tenantB,
        amount: -1,
        type: 'invoice_authorized',
        isReservation: true,
        createdAt: NOW,
      },
      tenantB,
    );
    const stillReserved = async () => {
      const [row]: Array<{ is_reservation: boolean }> = await db.query(
        `SELECT is_reservation FROM ${t('credit_transactions')} WHERE id = $1`,
        [reserved.id],
      );
      return row.is_reservation;
    };
    await repo.confirm(reserved.id, tenantA);
    await repo.cancelReservation(reserved.id, tenantA);
    expect(await stillReserved()).toBe(true);
    await repo.confirm(reserved.id, tenantB);
    expect(await stillReserved()).toBe(false);
  });

  it('integration connections: a write for tenant A cannot overwrite tenant B', async () => {
    const repo = new TypeOrmIntegrationConnectionRepository(
      db.getRepository(IntegrationConnectionOrmEntity),
    );
    const inserted = await repo.insert({
      id: randomUUID(),
      tenantId: tenantB,
      companyId: companyB,
      publicId: randomUUID().replaceAll('-', ''),
      provider: 'woovi',
      environment: 'test',
      externalAccountId: randomUUID(),
      state: 'active',
      credentialsEnc: 'enc',
      activeFrom: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Same id under tenant A: the update misses, the insert hits the primary key.
    await expect(
      repo.update({ ...inserted, tenantId: tenantA, state: 'paused' }),
    ).rejects.toThrow();
    const [row]: Array<{ state: string; tenant_id: string }> = await db.query(
      `SELECT state, tenant_id FROM ${t('integration_connections')} WHERE id = $1`,
      [inserted.id],
    );
    expect(row).toEqual({ state: 'active', tenant_id: tenantB });
  });

  it('invitations: tenant A cannot claim an invitation of tenant B', async () => {
    const repo = new TypeOrmTenantInvitationRepository(
      new TypeOrmRepositoryHelper(db, new TypeOrmTransactionContext()),
    );
    const id = randomUUID();
    await db.query(
      `INSERT INTO ${t('tenant_invitations')} (id,tenant_id,email,name,status,expires_at,token_hash) VALUES ($1,$2,'b@x.test','B','pending', now() + interval '1 day', 'hash')`,
      [id, tenantB],
    );
    const user = randomUUID();
    expect(await repo.claim(id, tenantA, user, new Date())).toBe(false);
    expect(await repo.claim(id, tenantB, user, new Date())).toBe(true);
    expect(await repo.claim(id, tenantB, user, new Date())).toBe(false);
  });
});
