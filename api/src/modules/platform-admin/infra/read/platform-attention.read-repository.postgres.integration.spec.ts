import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { PlatformReadSession } from '../platform-read-session';
import { PlatformAttentionReadRepository } from './platform-attention.read-repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Attention integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `patt_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const now = new Date('2026-11-23T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describePostgres('PlatformAttentionReadRepository (PostgreSQL)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: PlatformAttentionReadRepository;
  const table = (name: string) => `"${schema}"."${name}"`;

  const tenantA = randomUUID(); // has an older and a newer admin
  const tenantB = randomUUID(); // no admin membership -> falls back to tenant id
  const olderAdmin = randomUUID();
  const newerAdmin = randomUUID();
  const memberOnly = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const companyC = randomUUID();
  const companyD = randomUUID();
  const configA = randomUUID();
  const configB = randomUUID();

  async function user(id: string) {
    await admin.query(
      `INSERT INTO ${table('auth_users')} (id,email,name) VALUES ($1,$2,'U')`,
      [id, `${id}@t.test`],
    );
  }
  async function membership(
    userId: string,
    tenantId: string,
    memberRole: string,
    createdAt: Date,
  ) {
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role,created_at) VALUES ($1,$2,$3,$4)`,
      [userId, tenantId, memberRole, createdAt],
    );
  }
  async function company(id: string, tenantId: string, taxId: string) {
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id) VALUES ($1,$2,'Co',$3)`,
      [id, tenantId, taxId],
    );
  }
  async function invoice(
    companyId: string,
    tenantId: string,
    status: string,
    updatedAt: Date,
  ) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'{}','{}','{}',10,'2026-11-01',$5,$5)`,
      [id, companyId, tenantId, status, updatedAt],
    );
    return id;
  }
  async function certificate(
    companyId: string,
    validUntil: Date,
    status = 'active',
  ) {
    await admin.query(
      `INSERT INTO ${table('nfse_certificates')} (company_id,serial_number,issuer,subject,fingerprint,valid_from,valid_until,status,encrypted_blob,encrypted_dek,dek_iv)
       VALUES ($1,'s','i','sub',$2,$3,$4,$5,'\\x00','\\x00','\\x00')`,
      [companyId, randomUUID(), ago(365 * DAY), validUntil, status],
    );
  }
  async function delivery(tenantId: string, status: string, createdAt: Date) {
    const configId = tenantId === tenantA ? configA : configB;
    await admin.query(
      `INSERT INTO ${table('webhook_deliveries')} (tenant_id,webhook_config_id,event_type,url,status,created_at)
       VALUES ($1,$2,'invoice.authorized','https://x.test',$3,$4)`,
      [tenantId, configId, status, createdAt],
    );
  }
  async function intent(tenantId: string, status: string, createdAt: Date) {
    await admin.query(
      `INSERT INTO ${table('payment_intents')} (id,tenant_id,kind,amount_cents,provider,provider_ref,status,created_at)
       VALUES ($1,$2,'plan',1000,'stripe',$3,$4,$5)`,
      [randomUUID(), tenantId, randomUUID(), status, createdAt],
    );
  }

  beforeAll(async () => {
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
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
    repo = new PlatformAttentionReadRepository(
      new PlatformReadSession(runtime),
      runtime,
    );

    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const id of [olderAdmin, newerAdmin, memberOnly]) await user(id);
    await membership(newerAdmin, tenantA, 'admin', ago(1 * DAY));
    await membership(olderAdmin, tenantA, 'admin', ago(30 * DAY));
    await membership(memberOnly, tenantB, 'member', ago(30 * DAY));
    await company(companyA, tenantA, '11111111000111');
    await company(companyB, tenantA, '22222222000122');
    await company(companyC, tenantB, '33333333000133');
    await company(companyD, tenantB, '44444444000144');
    await admin.query(
      `INSERT INTO ${table('webhook_configs')} (id,tenant_id,url,events,secret) VALUES ($1,$2,'https://x.test','{}','s')`,
      [configA, tenantA],
    );
    await admin.query(
      `INSERT INTO ${table('webhook_configs')} (id,tenant_id,url,events,secret) VALUES ($1,$2,'https://x.test','{}','s')`,
      [configB, tenantB],
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

  it('nota retry_pending há 61 min entra; há 59 min e processing não entram', async () => {
    const stale = await invoice(
      companyA,
      tenantA,
      'retry_pending',
      ago(61 * MIN),
    );
    const manual = await invoice(
      companyA,
      tenantA,
      'manual_review',
      ago(3 * HOUR),
    );
    const recon = await invoice(
      companyC,
      tenantB,
      'reconciliation_required',
      ago(2 * HOUR),
    );
    const fresh = await invoice(
      companyA,
      tenantA,
      'retry_pending',
      ago(59 * MIN),
    );
    const processing = await invoice(
      companyA,
      tenantA,
      'processing',
      ago(5 * HOUR),
    );
    const ids = (await repo.snapshot(now)).staleInvoices.map(
      (i) => i.invoiceId,
    );
    expect(ids).toEqual(expect.arrayContaining([stale, manual, recon]));
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(processing);
    expect(ids[0]).toBe(manual); // oldest first
  });

  it('certificado a 14 dias e o já vencido entram; a 16 dias não', async () => {
    await certificate(companyA, new Date(now.getTime() + 14 * DAY));
    await certificate(companyB, new Date(now.getTime() - 2 * DAY));
    await certificate(companyC, new Date(now.getTime() + 16 * DAY));
    await certificate(companyD, new Date(now.getTime() + 1 * DAY), 'revoked');
    const certs = (await repo.snapshot(now)).expiringCertificates;
    expect(certs.map((c) => c.companyId).sort()).toEqual(
      [companyA, companyB].sort(),
    );
    expect(certs[0].companyId).toBe(companyB); // expired first
    expect(certs.find((c) => c.companyId === companyA)?.taxId).toBe(
      '11111111000111',
    );
  });

  it('webhook falho há 23 h entra; há 25 h não; contagem por tenant', async () => {
    await delivery(tenantA, 'failed', ago(23 * HOUR));
    await delivery(tenantA, 'failed', ago(2 * HOUR));
    await delivery(tenantA, 'failed', ago(25 * HOUR));
    await delivery(tenantA, 'sent', ago(1 * HOUR));
    await delivery(tenantB, 'failed', ago(25 * HOUR));
    const hooks = (await repo.snapshot(now)).failingWebhooks;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject({ tenantId: tenantA, failedCount24h: 2 });
    expect(hooks[0].lastFailureAt).toBe(ago(2 * HOUR).toISOString());
  });

  it('payment rejected/mismatch e past_due entram; paid e expired não', async () => {
    await intent(tenantA, 'rejected', ago(1 * DAY));
    await intent(tenantA, 'mismatch', ago(2 * DAY));
    await intent(tenantA, 'paid', ago(1 * DAY));
    await intent(tenantA, 'expired', ago(1 * DAY));
    await intent(tenantA, 'rejected', ago(31 * DAY));
    await admin.query(
      `INSERT INTO ${table('tenant_billing')} (tenant_id,stripe_status) VALUES ($1,'past_due')`,
      [tenantB],
    );
    const payments = (await repo.snapshot(now)).failedPayments;
    expect(
      payments.map((p) => `${p.source}:${p.status}:${p.tenantId}`).sort(),
    ).toEqual(
      [
        `intent:rejected:${tenantA}`,
        `intent:mismatch:${tenantA}`,
        `subscription:past_due:${tenantB}`,
      ].sort(),
    );
  });

  it('cada item traz userId do admin mais antigo do tenant (ou o tenantId sem admin)', async () => {
    const snap = await repo.snapshot(now);
    for (const i of snap.staleInvoices)
      expect(i.userId).toBe(i.tenantId === tenantA ? olderAdmin : tenantB);
    for (const c of snap.expiringCertificates)
      expect(c.userId).toBe(olderAdmin);
    for (const w of snap.failingWebhooks) expect(w.userId).toBe(olderAdmin);
    const sub = snap.failedPayments.find((p) => p.source === 'subscription');
    expect(sub?.userId).toBe(tenantB);
    const intentRow = snap.failedPayments.find((p) => p.source === 'intent');
    expect(intentRow?.userId).toBe(olderAdmin);
  });
});
