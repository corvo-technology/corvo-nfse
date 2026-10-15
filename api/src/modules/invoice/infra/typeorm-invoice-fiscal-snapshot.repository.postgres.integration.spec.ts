import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { FiscalCalculationResult } from '../domain/fiscal/fiscal-calculation-result';
import type { NewFiscalSnapshot } from '../domain/fiscal/fiscal-snapshot.repository';
import { TypeOrmInvoiceFiscalSnapshotRepository } from './typeorm-invoice-fiscal-snapshot.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `fiscal_snapshot_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();
const invoiceA = randomUUID(),
  invoiceB = randomUUID();

const calculationResult = (): FiscalCalculationResult => ({
  operationId: invoiceA,
  companyId: companyA,
  competenceDate: '2026-12-10',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: randomUUID(),
  classification: {
    serviceCode: '010601',
    municipalServiceCode: null,
    nbsCode: null,
    cst: null,
    classCode: null,
    operationIndicator: null,
    source: 'company_service_profile',
    serviceProfileId: null,
    operationNature: 'SERVICE',
    iss: {
      taxation: 'NORMAL',
      rate: '3',
      withholdingDefault: false,
      incidenceMunicipalityCode: '3550308',
    },
    withholding: { policy: 'NONE_CONFIRMED', rates: {} },
    catalogVersions: { nbs: '2026.1' },
    catalogValidated: true,
    justification: 'company service profile',
  },
  taxableAmounts: { gross: '1000.00', discount: '100.00', iss: '900.00' },
  taxes: {
    iss: { base: '900.00', rate: '3', amount: '27.00' },
    cbs: { base: '900.00', rate: '0.9', amount: '8.10' },
    ibsTotal: { base: '900.00', rate: '0.1', amount: '0.90' },
  },
  withholdings: [],
  netReceivableAmount: '864.90',
  applicability: {
    strategy: 'regular',
    customerRequired: true,
    iss: { status: 'REQUIRED' },
    issWithheld: { status: 'NOT_APPLICABLE', reason: 'no withholding' },
    federalWithholding: { status: 'NOT_APPLICABLE', reason: 'none' },
    cbs: { status: 'REQUIRED' },
    ibs: { status: 'REQUIRED' },
    specialTreatment: { status: 'NOT_APPLICABLE', reason: 'none' },
    collectionWaived: true,
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 116/2003'],
  },
  collectionWaived: true,
  calculationSource: 'legacy+rtc',
  calculatorVersion: 'rtc-2026.1',
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [
    { step: 'LegacyTaxCalculator', status: 'applied', durationMs: 1 },
    { step: 'RtcTaxCalculator', status: 'applied', durationMs: 2 },
  ],
  calculationMemory: [],
});

const snapshotOf = (
  tenantId: string,
  companyId: string,
  invoiceId: string,
  attempt = 1,
): NewFiscalSnapshot => ({
  invoiceId,
  tenantId,
  companyId,
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: randomUUID(),
  serviceProfileId: null,
  specialTaxRegime: null,
  attempt,
  calculationVersion: '2026.10-r1',
  grossAmount: '1000.00',
  discountAmount: '100.00',
  issAmount: '27.00',
  cbsAmount: '8.10',
  ibsTotalAmount: '0.90',
  netReceivableAmount: '864.90',
  result: calculationResult(),
  calculatedAt: new Date('2026-12-10T12:00:00Z'),
});

describePostgres(
  'invoice fiscal snapshot repository with restricted PostgreSQL role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repo: TypeOrmInvoiceFiscalSnapshotRepository;
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
      for (const [tenant, company, invoice] of [
        [tenantA, companyA, invoiceA],
        [tenantB, companyB, invoiceB],
      ] as const) {
        await admin.query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
          [company, tenant],
        );
        await admin.query(
          `INSERT INTO "${schema}".nfse_invoices (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment) VALUES ($1,$2,$3,'queued','{}','{}','{}',10,'2026-12-10','test')`,
          [invoice, company, tenant],
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
      repo = new TypeOrmInvoiceFiscalSnapshotRepository(
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

    it('inserts once per (invoice, attempt) and round-trips the result with decimal strings intact', async () => {
      const snapshot = snapshotOf(tenantA, companyA, invoiceA);
      const id = await runWithTenant(tenantA, () => repo.insert(snapshot));
      const redelivered = await runWithTenant(tenantA, () =>
        repo.insert(snapshot),
      );
      expect(redelivered).toBe(id);
      const rows = await admin.query(
        `SELECT id FROM "${schema}".invoice_fiscal_snapshots WHERE invoice_id=$1`,
        [invoiceA],
      );
      expect(rows).toHaveLength(1);

      const found = await runWithTenant(tenantA, () =>
        repo.findByInvoiceId(invoiceA, tenantA),
      );
      expect(found).not.toBeNull();
      expect(found?.id).toBe(id);
      expect(found?.tenantId).toBe(tenantA);
      expect(found?.companyId).toBe(companyA);
      expect(found?.attempt).toBe(1);
      expect(found?.calculationVersion).toBe('2026.10-r1');
      expect(found?.grossAmount).toBe('1000.00');
      expect(found?.netReceivableAmount).toBe('864.90');
      expect(found?.result.taxableAmounts).toEqual({
        gross: '1000.00',
        discount: '100.00',
        iss: '900.00',
      });
      expect(found?.result.taxes.iss?.amount).toBe('27.00');
      expect(found?.result.rulesVersion).toBe('2026.10-r1');
      expect(found?.result.trace).toEqual(snapshot.result.trace);
    });

    it('stores a later attempt as a new row and returns it as the latest', async () => {
      const firstId = await runWithTenant(tenantA, () =>
        repo.insert(snapshotOf(tenantA, companyA, invoiceA, 1)),
      );
      const secondId = await runWithTenant(tenantA, () =>
        repo.insert(snapshotOf(tenantA, companyA, invoiceA, 2)),
      );
      expect(secondId).not.toBe(firstId);
      const found = await runWithTenant(tenantA, () =>
        repo.findByInvoiceId(invoiceA, tenantA),
      );
      expect(found?.attempt).toBe(2);
    });

    it('rejects direct UPDATE and DELETE through the immutability trigger', async () => {
      const id = await runWithTenant(tenantA, () =>
        repo.insert(snapshotOf(tenantA, companyA, invoiceA)),
      );
      await expect(
        admin.query(
          `UPDATE "${schema}".invoice_fiscal_snapshots SET calculation_version='tampered' WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({
        driverError: { message: expect.stringContaining('immutable') },
      });
      await expect(
        admin.query(
          `DELETE FROM "${schema}".invoice_fiscal_snapshots WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({
        driverError: { message: expect.stringContaining('immutable') },
      });
    });

    it('removes the snapshot when the invoice is deleted through the cascade', async () => {
      const cascadeInvoice = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".nfse_invoices (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment) VALUES ($1,$2,$3,'queued','{}','{}','{}',10,'2026-12-10','test')`,
        [cascadeInvoice, companyA, tenantA],
      );
      await runWithTenant(tenantA, () =>
        repo.insert(snapshotOf(tenantA, companyA, cascadeInvoice)),
      );
      await runWithTenant(tenantA, () =>
        runtime.query(`DELETE FROM "${schema}".nfse_invoices WHERE id=$1`, [
          cascadeInvoice,
        ]),
      );
      expect(
        await admin.query(
          `SELECT id FROM "${schema}".invoice_fiscal_snapshots WHERE invoice_id=$1`,
          [cascadeInvoice],
        ),
      ).toEqual([]);
    });

    it('RLS hides snapshots from other tenants', async () => {
      await runWithTenant(tenantA, () =>
        repo.insert(snapshotOf(tenantA, companyA, invoiceA)),
      );
      expect(
        await runWithTenant(tenantB, () =>
          repo.findByInvoiceId(invoiceA, tenantB),
        ),
      ).toBeNull();
      const rows = await runWithTenant(tenantB, () =>
        runtime.query(
          `SELECT id FROM "${schema}".invoice_fiscal_snapshots WHERE tenant_id=$1`,
          [tenantA],
        ),
      );
      expect(rows).toEqual([]);
    });

    it('does not leak the isolated tenant B invoice into tenant A', async () => {
      expect(
        await runWithTenant(tenantA, () =>
          repo.findByInvoiceId(invoiceB, tenantA),
        ),
      ).toBeNull();
    });
  },
);
