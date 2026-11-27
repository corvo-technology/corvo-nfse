import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { CreditsPace } from '@/modules/credits-alerts/credits-pace.service';
import { previousMonth } from '@/modules/invoice/application/package/package-month';
import { brtMonthWindow } from '../brt-time';
import { LifecycleEmailLedger } from './lifecycle-email.ledger';
import { LifecycleStatsRepository } from './lifecycle-stats.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `lifecycle_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyA2 = randomUUID();
const companyB = randomUUID();
const testCompany = new Map<string, string>([
  [companyA, randomUUID()],
  [companyB, randomUUID()],
]);

const DAY_MS = 86_400_000;

describePostgres('lifecycle e-mails (RLS integration)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let ledger: LifecycleEmailLedger;
  let stats: LifecycleStatsRepository;
  let pace: CreditsPace;
  let discovery: TenantWorkDiscovery;
  const table = (name: string) => `"${schema}"."${name}"`;

  async function invoice(input: {
    tenantId: string;
    companyId: string;
    status?: string;
    environment?: string;
    amount?: number;
    customer?: Record<string, unknown>;
    authorizedAt?: Date | null;
    createdAt?: Date;
    id?: string;
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await admin.query(
      `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment,authorized_at,created_at) VALUES ($1,$2,$3,$4,$5,'{}','{}',$6,'2026-10-11',$7,$8,$9)`,
      [
        id,
        input.environment === 'test'
          ? testCompany.get(input.companyId)
          : input.companyId,
        input.tenantId,
        input.status ?? 'authorized',
        JSON.stringify(input.customer ?? { name: 'Cliente', taxId: '1' }),
        input.amount ?? 100,
        input.environment ?? 'live',
        input.authorizedAt === undefined
          ? new Date('2026-10-10T15:00:00Z')
          : input.authorizedAt,
        input.createdAt ?? new Date('2026-10-10T15:00:00Z'),
      ],
    );
    return id;
  }

  async function payment(input: {
    tenantId: string;
    status: string;
    createdAt: Date;
    paidAt?: Date | null;
    kind?: string;
    units?: number | null;
  }): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO ${table('payment_intents')} (id,tenant_id,kind,plan_slug,cycle,units,amount_cents,provider,provider_ref,status,paid_at,created_at) VALUES ($1,$2,$3,NULL,NULL,$4,5000,'stripe',$5,$6,$7,$8)`,
      [
        id,
        input.tenantId,
        input.kind ?? 'avulso',
        input.units === undefined ? 50 : input.units,
        `ref-${id}`,
        input.status,
        input.paidAt ?? null,
        input.createdAt,
      ],
    );
    return id;
  }

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
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment,accountant_email) VALUES ($1,$2,'Empresa A','11222333000181','live','contador@example.com'),($3,$2,'Empresa A2','11222333000182','live',NULL),($4,$5,'Empresa B','11222333000183','live',NULL)`,
      [companyA, tenantA, companyA2, companyB, tenantB],
    );
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Teste A','11222333000191','test'),($3,$4,'Teste B','11222333000192','test')`,
      [testCompany.get(companyA), tenantA, testCompany.get(companyB), tenantB],
    );
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
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
    const helper = new TypeOrmRepositoryHelper(
      runtime,
      new TypeOrmTransactionContext(),
    );
    ledger = new LifecycleEmailLedger(helper);
    stats = new LifecycleStatsRepository(helper);
    pace = new CreditsPace(helper);
    discovery = new TenantWorkDiscovery(runtime);
  }, 60000);

  afterEach(async () => {
    await admin.query(`DELETE FROM ${table('lifecycle_email_sends')}`);
    await admin.query(`DELETE FROM ${table('nfse_invoices')}`);
    await admin.query(`DELETE FROM ${table('payment_intents')}`);
  });

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  describe('ledger', () => {
    it('records a kind and period once and says so to the second caller', async () => {
      await expect(
        ledger.claim(tenantA, 'monthly-summary', '2026-10'),
      ).resolves.toBe(true);
      await expect(
        ledger.claim(tenantA, 'monthly-summary', '2026-10'),
      ).resolves.toBe(false);
      await expect(
        ledger.claim(tenantA, 'monthly-summary', '2026-11'),
      ).resolves.toBe(true);
    });

    it('lets two workers race and only one wins', async () => {
      const results = await Promise.all([
        ledger.claim(tenantA, 'first-invoice', 'once'),
        ledger.claim(tenantA, 'first-invoice', 'once'),
        ledger.claim(tenantA, 'first-invoice', 'once'),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('gives a claim back so the next run can send', async () => {
      await ledger.claim(tenantA, 'payment-pending', 'p1');
      await ledger.release(tenantA, 'payment-pending', 'p1');
      await expect(
        ledger.claim(tenantA, 'payment-pending', 'p1'),
      ).resolves.toBe(true);
    });

    it('counts what the workspace got since a moment', async () => {
      await ledger.claim(tenantA, 'first-invoice', 'once');
      await expect(
        ledger.countSince(tenantA, new Date(Date.now() - DAY_MS)),
      ).resolves.toBe(1);
      await expect(
        ledger.countSince(tenantA, new Date(Date.now() + DAY_MS)),
      ).resolves.toBe(0);
    });

    it('keeps one workspace out of another one', async () => {
      await ledger.claim(tenantB, 'monthly-summary', '2026-10');
      await expect(
        ledger.countSince(tenantA, new Date(Date.now() - DAY_MS)),
      ).resolves.toBe(0);
      await expect(
        ledger.claim(tenantA, 'monthly-summary', '2026-10'),
      ).resolves.toBe(true);
    });

    it('rejects raw SQL that reads or writes across tenants through the runtime role', async () => {
      await ledger.claim(tenantB, 'monthly-summary', '2026-10');
      await runWithTenant(tenantA, async () => {
        const rows: unknown[] = await runtime.query(
          `SELECT id FROM ${table('lifecycle_email_sends')}`,
        );
        expect(rows).toEqual([]);
        await expect(
          runtime.query(
            `INSERT INTO ${table('lifecycle_email_sends')} (tenant_id,kind,period) VALUES ($1,'first-invoice','once')`,
            [tenantB],
          ),
        ).rejects.toMatchObject({ driverError: { code: '42501' } });
      });
    });

    it('refuses a kind outside the allowed list', async () => {
      await expect(
        admin.query(
          `INSERT INTO ${table('lifecycle_email_sends')} (tenant_id,kind,period) VALUES ($1,'bogus','x')`,
          [tenantA],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    });
  });

  describe('first invoice', () => {
    const at = new Date('2026-11-02T12:00:00Z');

    it('is the first when nothing was authorized before it', async () => {
      const id = await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: at,
      });
      await expect(
        stats.hasEarlierLiveAuthorization(tenantA, id, at),
      ).resolves.toBe(false);
    });

    it('is not the first when a live invoice was authorized before', async () => {
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: new Date('2026-10-01T12:00:00Z'),
      });
      const id = await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: at,
      });
      await expect(
        stats.hasEarlierLiveAuthorization(tenantA, id, at),
      ).resolves.toBe(true);
    });

    it('ignores test invoices and other workspaces', async () => {
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        environment: 'test',
        authorizedAt: new Date('2026-10-01T12:00:00Z'),
      });
      await invoice({
        tenantId: tenantB,
        companyId: companyB,
        authorizedAt: new Date('2026-10-01T12:00:00Z'),
      });
      const id = await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: at,
      });
      await expect(
        stats.hasEarlierLiveAuthorization(tenantA, id, at),
      ).resolves.toBe(false);
    });
  });

  describe('monthly summary', () => {
    const start = new Date('2026-10-01T03:00:00Z');
    const end = new Date('2026-11-01T03:00:00Z');

    it('counts, totals, ranks customers by value and finds the company with an accountant', async () => {
      const ana = { name: 'Ana Silva', taxId: '111' };
      const beta = { name: 'Beta Ltda', taxId: '222' };
      const casa = { name: 'Casa Verde', taxId: '333' };
      const dani = { name: 'Dani', taxId: '444' };
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 500,
        customer: ana,
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 300,
        customer: beta,
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 300,
        customer: beta,
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 150,
        customer: casa,
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 10,
        customer: dani,
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        amount: 99,
        customer: { name: 'Consumidor' },
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        status: 'rejected',
        authorizedAt: null,
        createdAt: new Date('2026-10-20T12:00:00Z'),
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA2,
        amount: 1,
        customer: dani,
      });
      const summary = await stats.monthSummary(tenantA, start, end);
      expect(summary.count).toBe(7);
      expect(summary.totalCents).toBe(136_000);
      expect(summary.topCustomers).toEqual([
        'Beta Ltda',
        'Ana Silva',
        'Casa Verde',
      ]);
      expect(summary.rejected).toBe(1);
      expect(summary.mainCompany).toEqual({
        id: companyA,
        hasAccountant: true,
      });
    });

    it('says there is no accountant when the busiest company has none', async () => {
      await invoice({ tenantId: tenantA, companyId: companyA2 });
      const summary = await stats.monthSummary(tenantA, start, end);
      expect(summary.mainCompany).toEqual({
        id: companyA2,
        hasAccountant: false,
      });
    });

    it('leaves out test invoices, other months and other workspaces', async () => {
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        environment: 'test',
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: new Date('2026-09-30T12:00:00Z'),
      });
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: new Date('2026-11-01T03:00:00Z'),
      });
      await invoice({ tenantId: tenantB, companyId: companyB });
      const summary = await stats.monthSummary(tenantA, start, end);
      expect(summary).toMatchObject({
        count: 0,
        totalCents: 0,
        topCustomers: [],
      });
    });

    it('finds the workspaces to visit, only those with live invoices in the month before', async () => {
      const { start: monthStart } = brtMonthWindow(previousMonth(new Date()));
      const inMonth = new Date(monthStart.getTime() + 5 * DAY_MS);
      await invoice({
        tenantId: tenantA,
        companyId: companyA,
        authorizedAt: inMonth,
      });
      await invoice({
        tenantId: tenantB,
        companyId: companyB,
        environment: 'test',
        authorizedAt: inMonth,
      });
      const found = await discovery.discover(
        'lifecycle-monthly-summary',
        '00000000-0000-0000-0000-000000000000',
      );
      expect(found).toContain(tenantA);
      expect(found).not.toContain(tenantB);
    });
  });

  describe('pending purchases', () => {
    const now = Date.now();
    const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000);

    it('lists unpaid checkouts from 24 to 72 hours old, newest first', async () => {
      const recent = await payment({
        tenantId: tenantA,
        status: 'pending',
        createdAt: hoursAgo(2),
      });
      const old = await payment({
        tenantId: tenantA,
        status: 'expired',
        createdAt: hoursAgo(30),
      });
      const newer = await payment({
        tenantId: tenantA,
        status: 'pending',
        createdAt: hoursAgo(25),
      });
      const tooOld = await payment({
        tenantId: tenantA,
        status: 'pending',
        createdAt: hoursAgo(100),
      });
      const found = await stats.pendingPurchases(
        tenantA,
        hoursAgo(72),
        hoursAgo(24),
      );
      const ids = found.map((row) => row.id);
      expect(ids).toEqual([newer, old]);
      expect(ids).not.toContain(recent);
      expect(ids).not.toContain(tooOld);
      expect(found[0]).toMatchObject({ kind: 'avulso', units: 50 });
    });

    it('leaves out a purchase when the workspace paid something after it', async () => {
      await payment({
        tenantId: tenantA,
        status: 'pending',
        createdAt: hoursAgo(30),
      });
      await payment({
        tenantId: tenantA,
        status: 'paid',
        createdAt: hoursAgo(28),
        paidAt: hoursAgo(27),
      });
      await expect(
        stats.pendingPurchases(tenantA, hoursAgo(72), hoursAgo(24)),
      ).resolves.toEqual([]);
    });

    it('does not list paid, cancelled or other workspaces', async () => {
      await payment({
        tenantId: tenantA,
        status: 'cancelled',
        createdAt: hoursAgo(30),
      });
      await payment({
        tenantId: tenantB,
        status: 'pending',
        createdAt: hoursAgo(30),
      });
      await expect(
        stats.pendingPurchases(tenantA, hoursAgo(72), hoursAgo(24)),
      ).resolves.toEqual([]);
    });

    it('finds the workspaces to visit', async () => {
      await payment({
        tenantId: tenantA,
        status: 'pending',
        createdAt: hoursAgo(30),
      });
      await payment({
        tenantId: tenantB,
        status: 'pending',
        createdAt: hoursAgo(2),
      });
      const found = await discovery.discover(
        'lifecycle-payment-pending',
        '00000000-0000-0000-0000-000000000000',
      );
      expect(found).toContain(tenantA);
      expect(found).not.toContain(tenantB);
    });
  });

  describe('credits pace', () => {
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

    it('averages the live notes of the last 30 days', async () => {
      for (let day = 1; day <= 30; day++)
        await invoice({
          tenantId: tenantA,
          companyId: companyA,
          authorizedAt: daysAgo(day - 0.5),
        });
      const perDay = await pace.perDay(tenantA, now);
      expect(perDay).toBeCloseTo(1, 1);
    });

    it('uses the days since the first note when the history is shorter', async () => {
      for (let n = 0; n < 10; n++)
        await invoice({
          tenantId: tenantA,
          companyId: companyA,
          authorizedAt: daysAgo(10 - n * 0.5),
        });
      const perDay = await pace.perDay(tenantA, now);
      expect(perDay).toBeCloseTo(1, 0);
    });

    it('says nothing with too few notes or too little history', async () => {
      for (let n = 0; n < 4; n++)
        await invoice({
          tenantId: tenantA,
          companyId: companyA,
          authorizedAt: daysAgo(20 + n),
        });
      await expect(pace.perDay(tenantA, now)).resolves.toBeNull();
      await admin.query(`DELETE FROM ${table('nfse_invoices')}`);
      for (let n = 0; n < 6; n++)
        await invoice({
          tenantId: tenantA,
          companyId: companyA,
          authorizedAt: daysAgo(n * 0.5),
        });
      await expect(pace.perDay(tenantA, now)).resolves.toBeNull();
    });

    it('does not count test invoices or other workspaces', async () => {
      for (let n = 0; n < 10; n++) {
        await invoice({
          tenantId: tenantA,
          companyId: companyA,
          environment: 'test',
          authorizedAt: daysAgo(10 + n),
        });
        await invoice({
          tenantId: tenantB,
          companyId: companyB,
          authorizedAt: daysAgo(10 + n),
        });
      }
      await expect(pace.perDay(tenantA, now)).resolves.toBeNull();
    });
  });
});
