import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { PlatformReadSession } from '../platform-read-session';
import { PlatformOverviewReadRepository } from './platform-overview.read-repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Overview integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pov_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companies = {
  [`${'A'}live`]: randomUUID(),
  [`${'A'}test`]: randomUUID(),
  [`${'B'}live`]: randomUUID(),
};

// "now" = 2026-11-23 15:00Z (12:00 BRT); BRT day starts 2026-11-23T03:00Z.
const NOW = new Date('2026-11-23T15:00:00Z');

describePostgres('PlatformOverviewReadRepository (PostgreSQL)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: PlatformOverviewReadRepository;
  const table = (name: string) => `"${schema}"."${name}"`;

  async function invoice(
    tenantId: string,
    _companyId: string,
    environment: 'live' | 'test',
    status: string,
    when: string,
  ) {
    await admin.query(
      `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment,authorized_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'{}','{}','{}',10,'2026-11-01',$5,$6,$7,$7)`,
      [
        randomUUID(),
        companies[`${tenantId === tenantA ? 'A' : 'B'}${environment}`],
        tenantId,
        status,
        environment,
        status === 'authorized' ? when : null,
        when,
      ],
    );
  }

  async function payment(
    tenantId: string,
    o: {
      kind: string;
      provider: string;
      status: string;
      cents: number;
      paidAt: string | null;
      cycle?: string | null;
      key?: string | null;
    },
  ) {
    await admin.query(
      `INSERT INTO ${table('payment_intents')} (id,tenant_id,kind,cycle,amount_cents,provider,provider_ref,idempotency_key,status,paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        tenantId,
        o.kind,
        o.cycle ?? null,
        o.cents,
        o.provider,
        randomUUID(),
        o.key ?? null,
        o.status,
        o.paidAt,
      ],
    );
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
    for (const [key, id] of Object.entries(companies))
      await admin.query(
        `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,$4)`,
        [
          id,
          key.startsWith('A') ? tenantA : tenantB,
          String(Math.random()).slice(2, 16),
          key.slice(1),
        ],
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
    repo = new PlatformOverviewReadRepository(
      new PlatformReadSession(runtime),
      runtime,
    );

    // users
    for (const [email, created] of [
      ['a@x.com', '2026-11-22T12:00:00Z'],
      ['b@x.com', '2026-11-10T12:00:00Z'],
      ['c@x.com', '2026-09-01T12:00:00Z'],
    ])
      await admin.query(
        `INSERT INTO ${table('auth_users')} (id,email,name,created_at) VALUES ($1,$2,'n',$3)`,
        [randomUUID(), email, created],
      );

    // live: 23:30 BRT yesterday (= 02:30Z today) is NOT "today", is within 7d
    await invoice(tenantA, '', 'live', 'authorized', '2026-11-23T02:30:00Z');
    await invoice(tenantA, '', 'live', 'authorized', '2026-11-23T10:00:00Z');
    await invoice(tenantB, '', 'live', 'authorized', '2026-11-10T10:00:00Z');
    await invoice(tenantB, '', 'live', 'rejected', '2026-11-23T11:00:00Z');
    await invoice(tenantA, '', 'live', 'queued', '2026-11-23T11:00:00Z');
    // test environment, apart
    await invoice(tenantA, '', 'test', 'authorized', '2026-11-23T10:00:00Z');
    await invoice(tenantA, '', 'test', 'authorized', '2026-11-23T10:30:00Z');

    // revenue
    await payment(tenantA, {
      kind: 'plan',
      provider: 'stripe',
      status: 'paid',
      cents: 9900,
      paidAt: '2026-11-20T10:00:00Z',
      cycle: 'monthly',
    });
    await payment(tenantB, {
      kind: 'plan',
      provider: 'stripe',
      status: 'paid',
      cents: 9900,
      paidAt: '2026-11-05T10:00:00Z',
      cycle: 'monthly',
    });
    await payment(tenantA, {
      kind: 'avulso',
      provider: 'stripe',
      status: 'paid',
      cents: 2000,
      paidAt: '2026-11-22T10:00:00Z',
      key: 'k1',
    });
    // Woovi contract row (authorized) and mismatch never count
    await payment(tenantA, {
      kind: 'plan',
      provider: 'woovi',
      status: 'authorized',
      cents: 9900,
      paidAt: null,
      cycle: 'monthly',
    });
    await payment(tenantA, {
      kind: 'avulso',
      provider: 'woovi',
      status: 'mismatch',
      cents: 5000,
      paidAt: '2026-11-22T10:00:00Z',
    });
    // paid outside 30d
    await payment(tenantA, {
      kind: 'plan',
      provider: 'stripe',
      status: 'paid',
      cents: 7700,
      paidAt: '2026-09-01T10:00:00Z',
      cycle: 'monthly',
    });

    // admin grant (audit) + a bonus credit transaction that must not be revenue
    await admin.query(
      `INSERT INTO ${table('platform_admin_audit_events')} (id,actor_user_id,actor_email,action,target_tenant_id,payload,success,idempotency_key,created_at)
       VALUES ($1,$2,'o@x.com','credit_grant',$3,'{"amount":50}',true,'g1','2026-11-22T10:00:00Z'),
              ($4,$2,'o@x.com','credit_grant',$3,'{"amount":30}',true,'g2','2026-11-01T10:00:00Z'),
              ($5,$2,'o@x.com','credit_grant',$3,'{"amount":99}',false,NULL,'2026-11-22T10:00:00Z')`,
      [randomUUID(), randomUUID(), tenantA, randomUUID(), randomUUID()],
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

  it('conta usuários', async () => {
    const out = await repo.snapshot(NOW);
    expect(out.users).toEqual({ total: 3, new7d: 1, new30d: 2 });
  });

  it('nota autorizada às 23:30 BRT de ontem não conta em "hoje" mas conta em 7d', async () => {
    const { live } = (await repo.snapshot(NOW)).invoices;
    expect(live.today.authorized).toBe(1);
    expect(live.d7.authorized).toBe(2);
    expect(live.d30.authorized).toBe(3);
  });

  it('teste e produção são contados em separado, com taxa de rejeição', async () => {
    const { live, test } = (await repo.snapshot(NOW)).invoices;
    expect(test.today).toEqual({
      authorized: 2,
      rejected: 0,
      rejectionRate: 0,
    });
    expect(live.today.rejected).toBe(1);
    expect(live.today.rejectionRate).toBe(0.5);
    expect(live.d30.rejectionRate).toBe(0.25);
  });

  it('receita soma só paid: ignora a linha de contrato Woovi authorized e as mismatch', async () => {
    const { revenue } = await repo.snapshot(NOW);
    expect(revenue.d7).toEqual({
      subscriptionCents: 9900,
      avulsoCents: 2000,
      totalCents: 11900,
    });
    expect(revenue.d30.subscriptionCents).toBe(19800);
    expect(revenue.d30.avulsoCents).toBe(2000);
  });

  it('bônus do admin (credit_transactions bonus) não muda a receita e entra em adminGrants', async () => {
    const before = (await repo.snapshot(NOW)).revenue;
    await admin.query(
      `INSERT INTO ${table('credit_transactions')} (id,tenant_id,type,source,amount,created_at)
       VALUES ($1,$2,'bonus','bonus',50,'2026-11-22T10:00:00Z')`,
      [randomUUID(), tenantA],
    );
    const after = await repo.snapshot(NOW);
    expect(after.revenue).toEqual(before);
    expect(after.adminGrants).toEqual({ units7d: 50, units30d: 80 });
  });

  it('assinatura e avulso saem separados, e stripeRecordedSince é a menor paid_at da Stripe', async () => {
    const { revenue } = await repo.snapshot(NOW);
    expect(revenue.stripeRecordedSince).toBe('2026-09-01T10:00:00.000Z');
  });

  it('a consulta de 30 dias com 50 mil notas semeadas roda em menos de 1 s', async () => {
    await admin.query(
      `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment,authorized_at,created_at,updated_at)
       SELECT gen_random_uuid(), CASE WHEN g % 5 = 0 THEN $1::uuid ELSE $3::uuid END, $2, CASE WHEN g % 20 = 0 THEN 'rejected' ELSE 'authorized' END,
              '{}','{}','{}',10,'2026-11-01', CASE WHEN g % 5 = 0 THEN 'test' ELSE 'live' END,
              CASE WHEN g % 20 = 0 THEN NULL ELSE now() - (g % 400) * interval '1 day' END,
              now() - (g % 400) * interval '1 day', now() - (g % 400) * interval '1 day'
         FROM generate_series(1, 50000) g`,
      [companies.Atest, tenantA, companies.Alive],
    );
    await admin.query(`ANALYZE ${table('nfse_invoices')}`);
    const started = Date.now();
    await repo.snapshot(new Date());
    expect(Date.now() - started).toBeLessThan(1000);
  }, 60000);
});
