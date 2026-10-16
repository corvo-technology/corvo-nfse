import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { NewReconciliationRow } from '../../domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import { TypeOrmFiscalReconciliationRepository } from './typeorm-fiscal-reconciliation.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `fiscal_recon_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();
const invoiceA = randomUUID(),
  invoiceB = randomUUID();

const oldEnough = new Date(Date.now() - 60 * 60 * 1000);

const insertInvoice = (
  id: string,
  companyId: string,
  tenantId: string,
  status: string,
  updatedAt: Date,
) =>
  admin.query(
    `INSERT INTO "${schema}".nfse_invoices (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment,updated_at) VALUES ($1,$2,$3,$4,'{}','{}','{}',10,'2026-12-10','test',$5)`,
    [id, companyId, tenantId, status, updatedAt],
  );

let admin: DataSource;

const reconciliationOf = (
  invoiceId: string,
  tenantId: string,
  status: 'matched' | 'within_tolerance' | 'divergent' = 'matched',
): NewReconciliationRow => ({
  invoiceId,
  tenantId,
  status,
  localValues: { iss: '30.00', net_value: '864.90' },
  authorizedValues: { iss: '30', net_value: '864.9' },
  differences: [],
  toleranceAbsolute: '0.01',
  rulesVersion: '2026.10-r1',
  reconciledAt: new Date('2026-12-10T12:05:00Z'),
});

describePostgres(
  'invoice fiscal reconciliation repository with restricted PostgreSQL role',
  () => {
    let runtime: DataSource;
    let repo: TypeOrmFiscalReconciliationRepository;
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
      for (const [tenant, company] of [
        [tenantA, companyA],
        [tenantB, companyB],
      ] as const)
        await admin.query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
          [company, tenant],
        );
      for (const [tenant, company, invoice] of [
        [tenantA, companyA, invoiceA],
        [tenantB, companyB, invoiceB],
      ] as const)
        await insertInvoice(invoice, company, tenant, 'authorized', oldEnough);
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
      repo = new TypeOrmFiscalReconciliationRepository(
        runtime,
        new TypeOrmTransactionContext(),
      );
    }, 180000);
    afterAll(async () => {
      if (runtime?.isInitialized) await runtime.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        await admin.destroy();
      }
    });

    it('inserts once per invoice and round-trips the reconciled values as strings', async () => {
      const inserted = await runWithTenant(tenantA, () =>
        repo.insert(reconciliationOf(invoiceA, tenantA, 'within_tolerance')),
      );
      expect(inserted).toBe(true);
      const redelivered = await runWithTenant(tenantA, () =>
        repo.insert(reconciliationOf(invoiceA, tenantA, 'within_tolerance')),
      );
      expect(redelivered).toBe(false);
      const rows = await admin.query(
        `SELECT id FROM "${schema}".invoice_fiscal_reconciliations WHERE invoice_id=$1`,
        [invoiceA],
      );
      expect(rows).toHaveLength(1);

      const found = await runWithTenant(tenantA, () =>
        repo.findByInvoiceId(invoiceA, tenantA),
      );
      expect(found).not.toBeNull();
      expect(found?.invoiceId).toBe(invoiceA);
      expect(found?.tenantId).toBe(tenantA);
      expect(found?.status).toBe('within_tolerance');
      expect(found?.localValues).toEqual({ iss: '30.00', net_value: '864.90' });
      expect(found?.authorizedValues).toEqual({
        iss: '30',
        net_value: '864.9',
      });
      expect(found?.differences).toEqual([]);
      expect(found?.toleranceAbsolute).toBe('0.01');
      expect(found?.rulesVersion).toBe('2026.10-r1');
      expect(found?.reconciledAt).toBeInstanceOf(Date);
    });

    it('keeps differences as plain JSON with decimal strings intact', async () => {
      const divergentInvoice = randomUUID();
      await insertInvoice(
        divergentInvoice,
        companyA,
        tenantA,
        'authorized',
        oldEnough,
      );
      const row = reconciliationOf(divergentInvoice, tenantA, 'divergent');
      await runWithTenant(tenantA, () =>
        repo.insert({
          ...row,
          differences: [
            {
              field: 'iss',
              local: '30.00',
              authorized: '31.00',
              delta: '1.00',
              kind: 'amount',
            },
          ],
        }),
      );

      const found = await runWithTenant(tenantA, () =>
        repo.findByInvoiceId(divergentInvoice, tenantA),
      );
      expect(found?.differences).toEqual([
        {
          field: 'iss',
          local: '30.00',
          authorized: '31.00',
          delta: '1.00',
          kind: 'amount',
        },
      ]);
    });

    it('lists authorized invoices with a snapshot and no reconciliation only', async () => {
      const withReconciliation = randomUUID();
      const withSnapshot = randomUUID();
      const stillQueued = randomUUID();
      const withoutSnapshot = randomUUID();
      const recent = randomUUID();
      for (const [id, status, updatedAt] of [
        [withReconciliation, 'authorized', oldEnough],
        [withSnapshot, 'authorized', oldEnough],
        [stillQueued, 'queued', oldEnough],
        [withoutSnapshot, 'authorized', oldEnough],
        [recent, 'authorized', new Date()],
      ] as const)
        await insertInvoice(id, companyA, tenantA, status, updatedAt);
      for (const id of [withReconciliation, withSnapshot, stillQueued, recent])
        await admin.query(
          `INSERT INTO "${schema}".invoice_fiscal_snapshots (invoice_id,tenant_id,company_id,tax_regime,profile_id,calculation_version,gross_amount,discount_amount,net_receivable_amount,result) VALUES ($1,$2,$3,'LUCRO_PRESUMIDO',gen_random_uuid(),'2026.10-r1',1000,0,864.9,'{}')`,
          [id, tenantA, companyA],
        );
      await runWithTenant(tenantA, () =>
        repo.insert(reconciliationOf(withReconciliation, tenantA)),
      );

      const pending = await runWithTenant(tenantA, () =>
        repo.findAuthorizedWithoutReconciliation(
          tenantA,
          new Date(Date.now() - 5 * 60 * 1000),
          50,
        ),
      );

      expect(pending.map((row) => row.id).sort()).toEqual([withSnapshot]);
      expect(pending).toContainEqual(
        expect.objectContaining({
          id: withSnapshot,
          tenantId: tenantA,
          companyId: companyA,
        }),
      );
    });

    it('does not cross tenants when listing pending reconciliations', async () => {
      await admin.query(
        `INSERT INTO "${schema}".invoice_fiscal_snapshots (invoice_id,tenant_id,company_id,tax_regime,profile_id,calculation_version,gross_amount,discount_amount,net_receivable_amount,result) VALUES ($1,$2,$3,'LUCRO_PRESUMIDO',gen_random_uuid(),'2026.10-r1',1000,0,864.9,'{}')`,
        [invoiceB, tenantB, companyB],
      );

      const pending = await runWithTenant(tenantA, () =>
        repo.findAuthorizedWithoutReconciliation(
          tenantA,
          new Date(Date.now() + 60 * 60 * 1000),
          50,
        ),
      );

      expect(pending.map((row) => row.id)).not.toContain(invoiceB);
    });

    it('RLS hides reconciliations from other tenants', async () => {
      expect(
        await runWithTenant(tenantB, () =>
          repo.findByInvoiceId(invoiceA, tenantB),
        ),
      ).toBeNull();
      const rows = await runWithTenant(tenantB, () =>
        runtime.query(
          `SELECT id FROM "${schema}".invoice_fiscal_reconciliations WHERE tenant_id=$1`,
          [tenantA],
        ),
      );
      expect(rows).toEqual([]);
    });

    it('removes the reconciliation when the invoice is deleted through the cascade', async () => {
      const cascadeInvoice = randomUUID();
      await insertInvoice(
        cascadeInvoice,
        companyA,
        tenantA,
        'authorized',
        oldEnough,
      );
      await runWithTenant(tenantA, () =>
        repo.insert(reconciliationOf(cascadeInvoice, tenantA)),
      );
      await runWithTenant(tenantA, () =>
        runtime.query(`DELETE FROM "${schema}".nfse_invoices WHERE id=$1`, [
          cascadeInvoice,
        ]),
      );
      expect(
        await admin.query(
          `SELECT id FROM "${schema}".invoice_fiscal_reconciliations WHERE invoice_id=$1`,
          [cascadeInvoice],
        ),
      ).toEqual([]);
    });
  },
);
