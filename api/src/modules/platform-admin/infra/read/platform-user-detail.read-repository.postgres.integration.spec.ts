import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { PlatformReadSession } from '../platform-read-session';
import { PlatformUserDetailReadRepository } from './platform-user-detail.read-repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Platform admin integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pud_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;

const owner = randomUUID(); // user with an own workspace (tenant id = user id)
const guest = randomUUID(); // user invited to someone else's workspace only
const otherOwner = randomUUID();
const FULL_KEY = 'corvo_live_SECRETSECRETSECRETSECRET';

describePostgres('PlatformUserDetailReadRepository (PostgreSQL)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repository: PlatformUserDetailReadRepository;
  const table = (name: string) => `"${schema}"."${name}"`;

  beforeAll(async () => {
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();

    for (const [id, email] of [
      [owner, 'owner@example.invalid'],
      [guest, 'guest@example.invalid'],
      [otherOwner, 'other@example.invalid'],
    ])
      await admin.query(
        `INSERT INTO ${table('auth_users')} (id,email,name) VALUES ($1,$2,$2)`,
        [id, email],
      );
    await admin.query(
      `UPDATE ${table('auth_users')} SET email_verified_at = now(), last_login_at = now() WHERE id = $1`,
      [owner],
    );
    await admin.query(
      `INSERT INTO ${table('plans')} (id,slug,name) VALUES ($1,'free-fixture','Free') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
    await admin.query(
      `INSERT INTO ${table('tenants')} (id, plan_id) SELECT t, (SELECT id FROM ${table('plans')} WHERE slug = 'free-fixture') FROM unnest($1::uuid[]) t`,
      [[owner, otherOwner]],
    );
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$1,'admin'),($2,$3,'member'),($4,$3,'admin')`,
      [owner, guest, otherOwner, otherOwner],
    );
    await admin.query(
      `INSERT INTO ${table('billing_usage_periods')} (tenant_id,plan_slug,period_start,period_end,included,authorized,reserved) VALUES ($1,'free',now()-interval '1 day',now()+interval '20 days',10,3,1)`,
      [owner],
    );
    await admin.query(
      `INSERT INTO ${table('credit_transactions')} (tenant_id,amount,type,source) VALUES ($1,5,'bonus','bonus'),($1,3,'purchase','avulso'),($1,-1,'invoice_authorized','subscription')`,
      [owner],
    );

    const company = randomUUID();
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,municipality_code,environment) VALUES ($1,$2,'Empresa','11222333000181','3550308','live')`,
      [company, owner],
    );
    await admin.query(
      `INSERT INTO ${table('nfse_certificates')} (company_id,serial_number,issuer,subject,fingerprint,valid_from,valid_until,status,encrypted_blob,encrypted_dek,dek_iv) VALUES ($1,'1','i','s','f',now()-interval '1 day','2030-01-01T00:00:00Z','active','\\xdeadbeef','\\xdeadbeef','\\xdeadbeef')`,
      [company],
    );
    // A company with no certificate.
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,municipality_code,environment) VALUES ($1,$2,'Sem certificado','99888777000155','3550308','test')`,
      [randomUUID(), owner],
    );
    for (let i = 0; i < 25; i += 1)
      await admin.query(
        `INSERT INTO ${table('nfse_invoices')} (company_id,tenant_id,environment,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,created_at,last_error_code) VALUES ($1,$2,'live','authorized','{}','{}','{}',10,'2026-10-01',now()-($3 || ' minutes')::interval,$4)`,
        [company, owner, String(i), i === 0 ? 'E123' : null],
      );
    await admin.query(
      `INSERT INTO ${table('api_keys')} (tenant_id,name,environment,key_prefix,key_hash,scope) VALUES ($1,'Prod','live','corvo_live_abcd',$2,'full_access')`,
      [owner, `hash-of-${FULL_KEY}`],
    );
    await admin.query(
      `INSERT INTO ${table('payment_intents')} (id,tenant_id,kind,amount_cents,provider,provider_ref,status,checkout) VALUES ($1,$2,'avulso',2970,'stripe','ref-1','paid','{"brCode":"PIX-SECRET-PAYLOAD"}')`,
      [randomUUID(), owner],
    );
    await admin.query(
      `INSERT INTO ${table('auth_oauth_clients')} (id,name,redirect_uris) VALUES ('corvo-mcp','Claude','{}')`,
    );
    const session = randomUUID();
    await admin.query(
      `INSERT INTO ${table('auth_sessions')} (id,auth_user_id,client_id,kind,refresh_token_hash,active_tenant_id,expires_at) VALUES ($1,$2,'corvo-mcp','oauth_refresh','session-token-secret',$3,now()+interval '1 day')`,
      [session, owner, owner],
    );
    await admin.query(
      `INSERT INTO ${table('mcp_connections')} (auth_user_id,tenant_id,client_id,session_id,scopes) VALUES ($1,$2,'corvo-mcp',$3,'{nfse:read}')`,
      [owner, owner, session],
    );

    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [who]: Array<{ role: string }> = await admin.query(
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
        `migration_role=${who.role}`,
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
    repository = new PlatformUserDetailReadRepository(
      new PlatformReadSession(runtime),
      runtime,
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

  it('devolve null para usuário inexistente', async () => {
    await expect(repository.find(randomUUID())).resolves.toBeNull();
  });

  it('o JSON do detalhe não contém key_hash, checkout, encrypted_ nem a chave inteira (só keyPrefix)', async () => {
    const detail = await repository.find(owner);
    const json = JSON.stringify(detail);
    expect(json).toContain('corvo_live_abcd');
    for (const forbidden of [
      'key_hash',
      'keyHash',
      'hash-of-',
      'SECRETSECRET',
      'checkout',
      'brCode',
      'PIX-SECRET-PAYLOAD',
      'encrypted_',
      'deadbeef',
      'session-token-secret',
      'token',
    ])
      expect(json).not.toContain(forbidden);
    expect(detail!.workspaces[0].apiKeys[0]).toEqual({
      id: expect.any(String),
      name: 'Prod',
      keyPrefix: 'corvo_live_abcd',
      environment: 'live',
      lastUsedAt: null,
    });
    expect(detail!.workspaces[0].payments[0]).toMatchObject({
      kind: 'avulso',
      amountCents: 2970,
      status: 'paid',
    });
  });

  it('convidado aparece com o papel em cada workspace e isOwn só no próprio', async () => {
    const guestDetail = await repository.find(guest);
    expect(guestDetail!.workspaces).toHaveLength(1);
    expect(guestDetail!.workspaces[0]).toMatchObject({
      tenantId: otherOwner,
      role: 'member',
      isOwn: false,
    });
    const ownerDetail = await repository.find(owner);
    expect(ownerDetail!.user.lastLoginAt).not.toBeNull();
    expect(ownerDetail!.workspaces).toHaveLength(1);
    expect(ownerDetail!.workspaces[0]).toMatchObject({
      tenantId: owner,
      role: 'admin',
      isOwn: true,
      plan: { slug: 'free-fixture', name: 'Free' },
      avulsoBalance: 8,
      usage: { included: 10, authorized: 3, reserved: 1 },
    });
    expect(ownerDetail!.workspaces[0].mcpConnections).toEqual([
      { id: expect.any(String), clientName: 'Claude', lastUsedAt: null },
    ]);
  });

  it('limita as listas por workspace a 20, mais recentes primeiro', async () => {
    const detail = await repository.find(owner);
    const ws = detail!.workspaces[0];
    expect(ws.recentInvoices).toHaveLength(20);
    expect(ws.recentInvoices[0].lastErrorCode).toBe('E123');
    expect(ws.recentInvoices[0].amount).toBe(10);
  });

  it('certificateValidUntil vem da validade do certificado ativo e é null sem certificado', async () => {
    const detail = await repository.find(owner);
    const byName = Object.fromEntries(
      detail!.workspaces[0].companies.map((c) => [c.legalName, c]),
    );
    expect(byName['Empresa'].certificateValidUntil).toBe(
      '2030-01-01T00:00:00.000Z',
    );
    expect(byName['Sem certificado'].certificateValidUntil).toBeNull();
  });
});
