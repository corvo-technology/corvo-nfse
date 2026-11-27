/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest/raw SQL responses are untyped */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmInvoiceOverviewRepository } from './typeorm-invoice-overview.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Overview integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `overview_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const range = {
  start: new Date('2026-10-12T03:00:00Z'),
  end: new Date('2026-10-19T03:00:00Z'),
  timezone: 'America/Sao_Paulo',
};

describePostgres(
  'invoice overview with PostgreSQL and restricted tenant role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let repo: TypeOrmInvoiceOverviewRepository;
    const recentIds: string[] = [];
    let nfeRecentId = '';
    beforeAll(async () => {
      if (!url) throw new Error('Test database URL is required');
      admin = new DataSource(
        createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
      );
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.runMigrations();
      await admin.query(`CREATE SEQUENCE "${schema}".nfe_test_number`);
      await admin.query(
        `INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`,
        [tenantA, tenantB],
      );
      for (const [tenant, environment] of [
        [tenantA, 'test'],
        [tenantA, 'live'],
        [tenantB, 'test'],
      ]) {
        const company = randomUUID();
        await admin.query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181',$3)`,
          [company, tenant, environment],
        );
        // All competences deliberately predate the overview window.
        const insert = async (
          status: string,
          createdAt: string,
          authorizedAt: string | null,
          count = 1,
        ) => {
          const rows = await admin.query(
            `INSERT INTO "${schema}".nfse_invoices
          (company_id,tenant_id,environment,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,created_at,authorized_at)
          SELECT $1,$2,$3,$4,'{}','{}','{}',10,'2020-01-01',$5::timestamptz,$6::timestamptz FROM generate_series(1,$7)
          RETURNING id`,
            [
              company,
              tenant,
              environment,
              status,
              createdAt,
              authorizedAt,
              count,
            ],
          );
          return rows as { id: string }[];
        };
        const nfe = async (
          model: number,
          status: string,
          createdAt: string,
          authorizedAt: string | null,
        ) => {
          const rows = await admin.query(
            `INSERT INTO "${schema}".nfe_documents
          (tenant_id,company_id,environment,model,series,number,status,nat_op,id_dest,ind_final,ind_pres,recipient,totals,payment,transport,attempt,idempotency_key,request_hash,created_at,authorized_at)
          VALUES ($1,$2,$3,$4,1,nextval('${schema}.nfe_test_number'),$5,'Venda',1,1,1,'{"name":"Loja X"}'::jsonb,'{"vNF":"150.00"}'::jsonb,'{}'::jsonb,'{}'::jsonb,1,gen_random_uuid()::text,'h',$6::timestamptz,$7::timestamptz)
          RETURNING id`,
            [
              tenant,
              company,
              environment,
              model,
              status,
              createdAt,
              authorizedAt,
            ],
          );
          return (rows as { id: string }[])[0].id;
        };
        if (tenant === tenantA && environment === 'test') {
          nfeRecentId = await nfe(
            55,
            'authorized',
            '2026-10-18T13:00:00Z',
            '2026-10-18T13:00:00Z',
          );
          await nfe(65, 'denied', '2026-10-13T12:00:00Z', null);
          await nfe(65, 'queued', '2026-10-13T12:00:00Z', null);
          await nfe(55, 'discarded', '2026-10-18T14:00:00Z', null);
          // Outside the window.
          await nfe(
            55,
            'authorized',
            '2026-10-19T03:00:00Z',
            '2026-10-19T03:00:00Z',
          );
          await insert(
            'authorized',
            '2026-10-12T03:00:00Z',
            '2026-10-12T03:00:00Z',
            1201,
          );
          await insert('rejected', '2026-10-13T12:00:00Z', null);
          await insert('queued', '2026-10-13T12:00:00Z', null);
          await insert('processing', '2026-10-13T12:00:00Z', null);
          // Created earlier, authorized at the very end of the selected local day.
          await insert(
            'authorized',
            '2026-09-01T12:00:00Z',
            '2026-10-19T02:59:59.999Z',
          );
          // Both window boundaries are exclusive outside the range.
          await insert(
            'authorized',
            '2026-10-12T02:59:59.999Z',
            '2026-10-12T02:59:59.999Z',
          );
          await insert(
            'authorized',
            '2026-10-19T03:00:00Z',
            '2026-10-19T03:00:00Z',
          );
          await insert(
            'cancelled',
            '2026-09-01T12:00:00Z',
            '2026-10-18T12:00:00Z',
          );
          recentIds.push(
            ...(await insert('failed', '2026-10-18T12:00:00Z', null, 6)).map(
              (row) => row.id,
            ),
          );
        } else {
          await insert(
            'authorized',
            '2026-10-18T12:00:00Z',
            '2026-10-18T12:00:00Z',
            9,
          );
          await nfe(
            65,
            'authorized',
            '2026-10-18T12:00:00Z',
            '2026-10-18T12:00:00Z',
          );
        }
      }
      const password = randomBytes(24).toString('hex');
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
      );
      const [owner] = await admin.query('SELECT current_user AS role');
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
      runtime = new DataSource(
        createTypeOrmOptions({
          url: runtimeUrl.toString(),
          schema,
          ssl: false,
          logging: false,
        }),
      );
      await runtime.initialize();
      installRlsConnectionScope(runtime);
      repo = new TypeOrmInvoiceOverviewRepository(
        new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
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

    it('aggregates every invoice and uses creation time for counts and recent notes', async () => {
      const result = await repo.read(tenantA, 'test', range);
      expect(result.counts).toEqual({
        authorized: 1202,
        rejected: 2,
        processing: 3,
      });
      // The newest note is an NF-e; NFS-e come after it, as whole invoices.
      expect(result.recentInvoices.map((invoice) => invoice.id)).toEqual([
        nfeRecentId,
        ...recentIds.sort().reverse().slice(0, 4),
      ]);
      expect(result.recentInvoices[0]).toMatchObject({
        type: 'nfe',
        status: 'authorized',
        amount: '150.00',
        recipientName: 'Loja X',
      });
    });
    it('buckets by São Paulo authorization date, including older invoices and excluding cancelled ones', async () => {
      const result = await repo.read(tenantA, 'test', range);
      expect(result.dailyActivity).toEqual([
        { date: '2026-10-12', count: 1201 },
        { date: '2026-10-18', count: 2 },
      ]);
    });
    it('isolates tenants and execution environments under RLS', async () => {
      for (const [tenant, environment] of [
        [tenantA, 'live'],
        [tenantB, 'test'],
      ] as const) {
        const result = await repo.read(tenant, environment, range);
        expect(result.counts).toEqual({
          authorized: 10,
          rejected: 0,
          processing: 0,
        });
        expect(result.recentInvoices).toHaveLength(5);
        expect(
          result.recentInvoices.every(
            (invoice) =>
              (!('tenantId' in invoice) || invoice.tenantId === tenant) &&
              invoice.environment === environment,
          ),
        ).toBe(true);
      }
    });
  },
);
