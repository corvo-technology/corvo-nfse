import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PasswordlessWorkspaceService } from '@/modules/auth/application/passwordless-workspace.service';
import { TypeOrmWorkspaceRepository } from '@/modules/auth/infra/typeorm-workspace.repository';
import type { AuthUser } from '@/modules/auth/domain/auth-user';
import { McpAuthService } from '@/modules/mcp/mcp-auth.service';
import {
  TypeOrmOAuthAuthorizationCodeRepository,
  TypeOrmAuthSessionRepository,
} from '@/infra/persistence/typeorm/repositories/auth.repositories';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from './typeorm.options';
import { EnableTenantRls1791750000000 } from './migrations/1791750000000-EnableTenantRls';
import { installRlsConnectionScope } from './rls-connection-scope';
import {
  runAsSystem,
  runWithAuthUser,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { TypeOrmInvoiceRepository } from '@/modules/invoice/infra/typeorm-invoice.repository';
import { TypeOrmCompanyRepository } from '@/modules/company/infra/typeorm-company.repository';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { TypeOrmCertificateRepository } from '@/modules/certificate/infra/typeorm-certificate.repository';
import { CertificateOrmEntity } from '@/modules/certificate/infra/certificate.orm-entity';
import { TypeOrmDpsSequenceRepository } from '@/modules/invoice/infra/typeorm-dps-sequence.repository';
import { TypeOrmInvoiceEventRepository } from '@/modules/invoice/infra/typeorm-invoice-event.repository';
import { TypeOrmCreditTransactionRepository } from '@/modules/credits/infra/typeorm-credit-transaction.repository';
import { TypeOrmWebhookConfigRepository } from '@/modules/webhooks-config/infra/typeorm-webhook-config.repository';
import { WebhookConfigEntity } from '@/modules/webhooks-config/infra/webhook-config.orm-entity';
import { TypeormWebhookDeliveryRepository } from '@/modules/webhooks-config/infra/typeorm-webhook-delivery.repository';
import { WebhookDeliveryOrmEntity } from '@/modules/webhooks-config/infra/webhook-delivery.orm-entity';
import { TypeormTenantSettingsRepository } from '@/modules/auth/infra/typeorm-tenant-settings.repository';
import { TenantSettingsOrmEntity } from '@/modules/auth/infra/tenant-settings.orm-entity';
import { TypeOrmMcpConnectionRepository } from '@/modules/mcp/infra/mcp-connection.repository';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmBillingRepository } from '@/modules/billing/infra/typeorm-billing.repository';
import { RlsConnectionScopeService } from './rls-connection-scope.service';
import { EnforceTenantReferences1791740000000 } from './migrations/1791740000000-EnforceTenantReferences';
import { TypeOrmTenantMembershipRepository } from '@/infra/persistence/typeorm/repositories/tenant-membership.repository';
import { TypeOrmTenantInvitationRepository } from '@/infra/persistence/typeorm/repositories/tenant-invitation.repository';
import { TypeOrmAuthUserRepository } from '@/infra/persistence/typeorm/repositories/auth.repositories';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeormApiKeyRepository } from '@/modules/auth/infra/typeorm-api-key.repository';
import { ApiKeyOrmEntity } from '@/modules/auth/infra/api-key.orm-entity';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `rls_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const user = randomUUID(),
  otherUser = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID();
const invoiceA = randomUUID(),
  invoiceB = randomUUID();
const certificateA = randomUUID(),
  certificateB = randomUUID();
const configA = randomUUID(),
  configB = randomUUID();
const deliveryA = randomUUID(),
  deliveryB = randomUUID();
const settingsA = randomUUID(),
  settingsB = randomUUID();
const connectionA = randomUUID(),
  connectionB = randomUUID();
const periodB = randomUUID(),
  creditB = randomUUID();

describePostgres('strict tenant RLS with a restricted PostgreSQL role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  const table = (name: string) => `"${schema}"."${name}"`;
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
      `INSERT INTO ${table('auth_users')} (id,email,name) VALUES ($1,'rls@example.invalid','RLS'),($2,'other@example.invalid','Other')`,
      [user, otherUser],
    );
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id) VALUES ($1,$2),($1,$3),($4,$3)`,
      [user, tenantA, tenantB, otherUser],
    );
    await admin.query(
      `INSERT INTO ${table('auth_oauth_clients')} (id,name,redirect_uris) VALUES ('corvo-mcp','MCP','{}')`,
    );
    await admin.query(
      `INSERT INTO ${table('plans')} (id,name,slug) VALUES ($1,'Free','free')`,
      [randomUUID()],
    );
    for (const [
      tenant,
      company,
      invoice,
      certificate,
      config,
      delivery,
      settings,
      connection,
    ] of [
      [
        tenantA,
        companyA,
        invoiceA,
        certificateA,
        configA,
        deliveryA,
        settingsA,
        connectionA,
      ],
      [
        tenantB,
        companyB,
        invoiceB,
        certificateB,
        configB,
        deliveryB,
        settingsB,
        connectionB,
      ],
    ]) {
      await admin.query(
        `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
        [company, tenant],
      );
      await admin.query(
        `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment) VALUES ($1,$2,$3,'queued','{}','{}','{}',10,'2026-10-11','test')`,
        [invoice, company, tenant],
      );
      await admin.query(
        `INSERT INTO ${table('nfse_invoice_events')} (invoice_id,to_status) VALUES ($1,'queued')`,
        [invoice],
      );
      await admin.query(
        `INSERT INTO ${table('nfse_certificates')} (id,company_id,serial_number,issuer,subject,fingerprint,valid_from,valid_until,encrypted_blob,encrypted_dek,dek_iv) VALUES ($1,$2,'serial','issuer','subject',$1::uuid::text,now()-interval '2 years',now()-interval '1 year',$3,$3,$3)`,
        [certificate, company, Buffer.from('fixture')],
      );
      await admin.query(
        `INSERT INTO ${table('nfse_dps_sequences')} (company_id) VALUES ($1)`,
        [company],
      );
      await admin.query(
        `INSERT INTO ${table('webhook_configs')} (id,tenant_id,url,secret,events) VALUES ($1,$2,'https://example.invalid','fixture','{webhook.test}')`,
        [config, tenant],
      );
      await admin.query(
        `INSERT INTO ${table('webhook_deliveries')} (id,tenant_id,webhook_config_id,event_type,url,environment) VALUES ($1,$2,$3,'webhook.test','https://example.invalid','test')`,
        [delivery, tenant, config],
      );
      await admin.query(
        `INSERT INTO ${table('tenant_settings')} (id,tenant_id,timezone) VALUES ($1,$2,'America/Sao_Paulo')`,
        [settings, tenant],
      );
      const session = randomUUID();
      await admin.query(
        `INSERT INTO ${table('auth_sessions')} (id,auth_user_id,client_id,kind,refresh_token_hash,active_tenant_id,expires_at) VALUES ($1,$2,'corvo-mcp','oauth_refresh',$1::uuid::text,$3,now()+interval '1 day')`,
        [session, user, tenant],
      );
      await admin.query(
        `INSERT INTO ${table('mcp_connections')} (id,auth_user_id,tenant_id,client_id,session_id,scopes) VALUES ($1,$2,$3,'corvo-mcp',$4,'{nfse:read}')`,
        [connection, user, tenant, session],
      );
    }
    await admin.query(
      `INSERT INTO ${table('credit_transactions')} (id,tenant_id,amount,type) VALUES ($1,$2,10,'bonus')`,
      [creditB, tenantB],
    );
    await admin.query(
      `INSERT INTO ${table('billing_usage_periods')} (id,tenant_id,plan_slug,period_start,period_end,included) VALUES ($1,$2,'free','2026-10-01','2026-11-01',10)`,
      [periodB, tenantB],
    );
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    // Exercise the reviewed provisioning artifact, including a repeated invocation.
    for (let index = 0; index < 2; index++)
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
  }, 180000);
  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });
  const workspaceHarness = () => {
    const context = new TypeOrmTransactionContext();
    const helper = new TypeOrmRepositoryHelper(runtime, context);
    const service = new PasswordlessWorkspaceService(
      new TypeOrmUnitOfWork(runtime, context),
      new TypeOrmWorkspaceRepository(helper, context),
    );
    return { helper, service };
  };
  const createAuthUser = async (): Promise<AuthUser> => {
    const id = randomUUID();
    const email = `${id}@example.invalid`;
    await admin.query(
      `INSERT INTO ${table('auth_users')} (id,email,name) VALUES ($1,$2,'Bootstrap')`,
      [id, email],
    );
    return {
      id,
      email,
      name: 'Bootstrap',
      emailVerifiedAt: null,
      primaryIdentityType: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };

  it('serializes simultaneous workspace bootstrap and rejects inactive membership and reused email', async () => {
    const account = await createAuthUser();
    const { service } = workspaceHarness();
    await Promise.all([
      service.ensureWorkspace(account),
      workspaceHarness().service.ensureWorkspace(account),
    ]);
    for (const [name, column] of [
      ['tenants', 'id'],
      ['tenant_billing', 'tenant_id'],
      ['tenant_memberships', 'auth_user_id'],
    ]) {
      expect(
        await admin.query(`SELECT 1 FROM ${table(name)} WHERE ${column}=$1`, [
          account.id,
        ]),
      ).toHaveLength(1);
    }
    await admin.query(
      `UPDATE ${table('tenant_memberships')} SET is_active=false WHERE auth_user_id=$1`,
      [account.id],
    );
    await expect(service.ensureWorkspace(account)).rejects.toThrow(
      'Tenant membership is inactive',
    );
    const duplicate = await createAuthUser();
    await admin.query(
      `UPDATE ${table('tenant_billing')} SET billing_email=$1 WHERE tenant_id=$2`,
      [duplicate.email.toUpperCase(), account.id],
    );
    await expect(service.ensureWorkspace(duplicate)).rejects.toThrow(
      'Email already belongs to a free workspace',
    );
    expect(
      await admin.query(`SELECT 1 FROM ${table('tenants')} WHERE id=$1`, [
        duplicate.id,
      ]),
    ).toEqual([]);
  });

  it('rolls back workspace and billing when the membership insert fails', async () => {
    const account = await createAuthUser();
    await admin.query(
      `CREATE FUNCTION "${schema}".reject_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.auth_user_id='${account.id}'::uuid THEN RAISE EXCEPTION 'membership down'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER reject_bootstrap BEFORE INSERT ON ${table('tenant_memberships')} FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_bootstrap()`,
    );
    try {
      await expect(
        workspaceHarness().service.ensureWorkspace(account),
      ).rejects.toThrow('membership down');
      for (const [name, column] of [
        ['tenants', 'id'],
        ['tenant_billing', 'tenant_id'],
        ['tenant_memberships', 'auth_user_id'],
      ]) {
        expect(
          await admin.query(`SELECT 1 FROM ${table(name)} WHERE ${column}=$1`, [
            account.id,
          ]),
        ).toEqual([]);
      }
    } finally {
      await admin.query(
        `DROP TRIGGER reject_bootstrap ON ${table('tenant_memberships')}`,
      );
      await admin.query(`DROP FUNCTION "${schema}".reject_bootstrap()`);
    }
  });

  it('consumes codes and rotates refresh tokens once through real repository contracts', async () => {
    const account = await createAuthUser();
    const { service, helper } = workspaceHarness();
    await service.ensureWorkspace(account);
    const codes = new TypeOrmOAuthAuthorizationCodeRepository(helper);
    const sessions = new TypeOrmAuthSessionRepository(helper);
    const mcp = new McpAuthService(
      codes,
      sessions,
      new TypeOrmMcpConnectionRepository(helper),
      new ConfigService({ auth: { jwtSecret: 'a'.repeat(32) } }),
      new TypeOrmTenantMembershipRepository(helper),
    );
    const verifier = 'repository-contract-verifier';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await mcp.createAuthorizationCode({
      clientId: 'corvo-mcp',
      userId: account.id,
      tenantId: account.id,
      redirectUri: 'https://example.invalid/callback',
      scope: 'nfse:read',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    const exchanged = await Promise.allSettled(
      [1, 2].map(() =>
        mcp.exchangeCode({
          code,
          codeVerifier: verifier,
          clientId: 'corvo-mcp',
          redirectUri: 'https://example.invalid/callback',
        }),
      ),
    );
    const successes = exchanged.filter(
      (result) => result.status === 'fulfilled',
    );
    expect(successes).toHaveLength(1);
    const tokens = successes[0].value;
    const payload = await mcp.validateAccessToken(tokens.accessToken);
    expect(payload.tenant_id).toBe(account.id);
    const rotated = await Promise.allSettled([
      mcp.refreshTokens(tokens.refreshToken),
      mcp.refreshTokens(tokens.refreshToken),
    ]);
    expect(
      rotated.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    await mcp.revokeSession(payload.session_id!, tenantB, account.id);
    await expect(
      mcp.validateAccessToken(tokens.accessToken),
    ).resolves.toMatchObject({ sub: account.id });
    await mcp.revokeSession(payload.session_id!, account.id, account.id);
    await expect(mcp.validateAccessToken(tokens.accessToken)).rejects.toThrow(
      'Invalid or revoked session',
    );
  });

  it('enables and forces RLS on all 29 tenant tables', async () => {
    const rows: Array<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }> = await admin.query(
      'SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relrowsecurity',
      [schema],
    );
    expect(rows).toHaveLength(29);
    expect(rows.every((row) => row.relforcerowsecurity)).toBe(true);
    const [flags]: Array<{ rolsuper: boolean; rolbypassrls: boolean }> =
      await runtime.query(
        'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
      );
    expect(flags).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('denies unscoped SQL and reapplies context on a reused connection', async () => {
    expect(
      await runtime.query(`SELECT id FROM ${table('nfse_companies')}`),
    ).toEqual([]);
    const requests = Array.from({ length: 20 }, (_, index) => {
      const tenant = index % 2 ? tenantA : tenantB;
      return runWithTenant(tenant, async () => {
        const rows: Array<{ tenant_id: string }> = await runtime.query(
          `SELECT tenant_id FROM ${table('nfse_companies')}`,
        );
        expect(rows).toEqual([{ tenant_id: tenant }]);
      });
    });
    await Promise.all(requests);
    expect(
      await runtime.query(`SELECT id FROM ${table('nfse_companies')}`),
    ).toEqual([]);
    await runAsSystem('worker-discovery', () =>
      runtime.query(`SELECT set_config('app.system_context','on',false)`),
    );
    expect(
      await runtime.query(`SELECT id FROM ${table('nfse_companies')}`),
    ).toEqual([]);
  });
  it('blocks cross-tenant writes, deletes and changes of ownership through raw SQL', async () => {
    await runWithTenant(tenantA, async () => {
      const [, updated] = await runtime.query<[unknown[], number]>(
        `UPDATE ${table('nfse_companies')} SET legal_name='Intruder' WHERE id=$1 RETURNING id`,
        [companyB],
      );
      expect(updated).toBe(0);
      const [, deleted] = await runtime.query<[unknown[], number]>(
        `DELETE FROM ${table('nfse_companies')} WHERE id=$1 RETURNING id`,
        [companyB],
      );
      expect(deleted).toBe(0);
      await expect(
        runtime.query(
          `UPDATE ${table('nfse_companies')} SET tenant_id=$1 WHERE id=$2`,
          [tenantB, companyA],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await expect(
        runtime.query(
          `INSERT INTO ${table('credit_transactions')} (tenant_id,amount,type) VALUES ($1,1,'bonus')`,
          [tenantB],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    });
  });
  it.each(['nfse_certificates', 'nfse_dps_sequences', 'nfse_invoice_events'])(
    'scopes the child table %s through its parent',
    async (child) => {
      expect(await runtime.query(`SELECT * FROM ${table(child)}`)).toEqual([]);
      await runWithTenant(tenantA, async () => {
        const rows: Array<{ company_id?: string; invoice_id?: string }> =
          await runtime.query(`SELECT * FROM ${table(child)}`);
        expect(rows).toHaveLength(1);
        expect(rows[0].company_id ?? rows[0].invoice_id).toBe(
          child === 'nfse_invoice_events' ? invoiceA : companyA,
        );
      });
    },
  );
  it('allows only the authenticated user membership selector across tenants', async () => {
    expect(
      await runtime.query(`SELECT id FROM ${table('tenant_memberships')}`),
    ).toEqual([]);
    await runWithAuthUser(user, async () => {
      const rows: Array<{ auth_user_id: string }> = await runtime.query(
        `SELECT auth_user_id FROM ${table('tenant_memberships')}`,
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.auth_user_id === user)).toBe(true);
      await expect(
        runtime.query(
          `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id) VALUES ($1,$2)`,
          [user, randomUUID()],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    });
    expect(
      (await runtime.query<unknown[]>(`SELECT id FROM ${table('plans')}`))
        .length,
    ).toBeGreaterThan(0);
  });
  it('excludes queued recovery and scopes processing/reconciliation worker callbacks', async () => {
    const discovery = new TenantWorkDiscovery(runtime);
    const after = '00000000-0000-0000-0000-000000000000';
    expect(await discovery.discover('invoice-recovery', after)).toEqual([]);
    try {
      await admin.query(
        `UPDATE ${table('nfse_invoices')} SET status = CASE WHEN id = $1 THEN 'processing' ELSE 'reconciliation_required' END WHERE id IN ($1,$2)`,
        [invoiceA, invoiceB],
      );
      const seen: string[] = [];
      await discovery.visit('invoice-recovery', async (tenantId) => {
        seen.push(tenantId);
        const rows: Array<{ tenant_id: string }> = await runtime.query(
          `SELECT tenant_id FROM ${table('nfse_invoices')}`,
        );
        expect(rows).toEqual([{ tenant_id: tenantId }]);
      });
      expect(seen.sort()).toEqual([tenantA, tenantB].sort());
    } finally {
      await admin.query(
        `UPDATE ${table('nfse_invoices')} SET status = 'queued' WHERE id IN ($1,$2)`,
        [invoiceA, invoiceB],
      );
    }
    expect(await discovery.discover('invoice-recovery', after)).toEqual([]);
  });
  it('checks parent ownership in certificate, event and DPS repositories', async () => {
    const certificates = new TypeOrmCertificateRepository(
      runtime.getRepository(CertificateOrmEntity),
    );
    expect(
      await certificates.findById(certificateB, tenantA, 'test'),
    ).toBeNull();
    const certificate = await certificates.findById(
      certificateA,
      tenantA,
      'test',
    );
    expect(certificate).not.toBeNull();
    await certificates.save(certificate!, tenantA, 'test');
    await expect(
      certificates.save(certificate!, tenantB, 'test'),
    ).rejects.toThrow('Resource not found');
    expect(await certificates.expireExpiredCertificates(tenantA)).toEqual([
      companyA,
    ]);
    const events = new TypeOrmInvoiceEventRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
    expect(await events.findByInvoiceId(invoiceB, tenantA)).toEqual([]);
    const event = (await events.findByInvoiceId(invoiceA, tenantA))[0];
    await expect(events.save(event, tenantB)).rejects.toThrow();
    const sequence = new TypeOrmDpsSequenceRepository(runtime);
    expect(await sequence.reserveNext(companyA, tenantA, 'test')).toEqual({
      series: '1',
      number: 1,
    });
    await expect(
      sequence.reserveNext(companyB, tenantA, 'test'),
    ).rejects.toThrow('Resource not found');
    expect(await sequence.raiseTo(companyA, tenantA, 'test', 120)).toEqual({
      series: '1',
      lastNumber: 120,
    });
    // It only moves forward: a lower number is ignored, and the next DPS follows the highest.
    expect(await sequence.raiseTo(companyA, tenantA, 'test', 5)).toEqual({
      series: '1',
      lastNumber: 120,
    });
    expect(await sequence.reserveNext(companyA, tenantA, 'test')).toEqual({
      series: '1',
      number: 121,
    });
    // Concurrent allocations after raising the start never repeat a number nor go backwards.
    await sequence.raiseTo(companyA, tenantA, 'test', 500);
    const burst = await Promise.all(
      Array.from({ length: 8 }, () =>
        sequence.reserveNext(companyA, tenantA, 'test'),
      ),
    );
    expect(burst.map((r) => r.number).sort((a, b) => a - b)).toEqual([
      501, 502, 503, 504, 505, 506, 507, 508,
    ]);
    await expect(
      sequence.raiseTo(companyB, tenantA, 'test', 10),
    ).rejects.toThrow('Resource not found');
  });
  it('scopes company and invoice reads, saves and status mutations', async () => {
    const companies = new TypeOrmCompanyRepository(
      runtime.getRepository(CompanyOrmEntity),
    );
    const invoices = new TypeOrmInvoiceRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
    expect(
      await companies.findByIdAndTenantId(companyB, tenantA, 'test'),
    ).toBeNull();
    const invoice = await invoices.findByIdAndTenantId(invoiceA, tenantA);
    await invoices.save(invoice!, tenantA);
    await expect(invoices.save(invoice!, tenantB)).rejects.toThrow(
      'Resource not found',
    );
    expect(
      await invoices.markDocumentsReady(invoiceB, tenantA, new Date()),
    ).toBe(false);
    await invoices.updateEmailStatus(invoiceB, tenantA, 'sent');
    expect(await invoices.findByIdAndTenantId(invoiceB, tenantA)).toBeNull();
    const [row]: Array<{ last_email_status: null }> = await admin.query(
      `SELECT last_email_status FROM ${table('nfse_invoices')} WHERE id=$1`,
      [invoiceB],
    );
    expect(row.last_email_status).toBeNull();
  });
  it('isolates webhook, settings, credit, billing and MCP repository operations', async () => {
    const configs = new TypeOrmWebhookConfigRepository(
      runtime.getRepository(WebhookConfigEntity),
    );
    expect(await configs.findByIdAndTenantId(configB, tenantA)).toBeNull();
    const own = await configs.findByIdAndTenantId(configA, tenantA);
    await configs.save(own!, tenantA);
    await expect(configs.save(own!, tenantB)).rejects.toThrow(
      'Resource not found',
    );
    const foreign = await configs.findByIdAndTenantId(configB, tenantB);
    await configs.remove(foreign!, tenantA).catch(() => undefined);
    expect(await configs.findByIdAndTenantId(configB, tenantB)).not.toBeNull();
    const deliveries = new TypeormWebhookDeliveryRepository(
      runtime.getRepository(WebhookDeliveryOrmEntity),
    );
    expect(await deliveries.findByIdAndTenantId(deliveryB, tenantA)).toBeNull();
    await deliveries.update(deliveryB, tenantA, { status: 'sent' });
    expect(
      (await deliveries.findByIdAndTenantId(deliveryB, tenantB))?.status,
    ).toBe('pending');
    const settings = new TypeormTenantSettingsRepository(
      runtime.getRepository(TenantSettingsOrmEntity),
    );
    await settings.update(settingsB, tenantA, { timezone: 'UTC' });
    expect((await settings.findByTenantId(tenantB))?.timezone).toBe(
      'America/Sao_Paulo',
    );
    const credits = new TypeOrmCreditTransactionRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
    expect(await credits.calculateBalance(tenantA)).toBe(0);
    expect(await credits.calculateBalance(tenantB)).toBe(10);
    const billing = new TypeOrmBillingRepository(
      runtime,
      new TypeOrmTransactionContext(),
    );
    expect(await billing.period(periodB, tenantA)).toBeNull();
    const mcp = new TypeOrmMcpConnectionRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
    expect(
      (await mcp.findAllByUserAndTenant(user, tenantA)).map((row) => row.id),
    ).toEqual([connectionA]);
    expect(await mcp.findByIdAndOwner(connectionB, tenantA, user)).toBeNull();
    await mcp.revoke(connectionB, tenantA, user);
    expect(
      (await mcp.findByIdAndOwner(connectionB, tenantB, user))?.revokedAt,
    ).toBeNull();
  });
  it('rejects absent tenant context before repository SQL and nested tenant changes', async () => {
    const invoices = new TypeOrmInvoiceRepository(
      new TypeOrmRepositoryHelper(runtime, new TypeOrmTransactionContext()),
    );
    await expect(
      invoices.findByIdAndTenantId(invoiceB, undefined as unknown as string),
    ).rejects.toThrow('tenant context');
    await expect(invoices.findByIdAndTenantId(invoiceB, '')).rejects.toThrow(
      'tenant context',
    );
    await runWithTenant(tenantA, async () => {
      await expect(
        invoices.findByIdAndTenantId(invoiceB, tenantB),
      ).rejects.toThrow('Resource not found');
    });
  });
  it('scopes account enrichment, memberships, invitations and API keys', async () => {
    const helper = new TypeOrmRepositoryHelper(
      runtime,
      new TypeOrmTransactionContext(),
    );
    const members = new TypeOrmTenantMembershipRepository(helper);
    const foreign = (await members.listByTenant(tenantB)).find(
      (member) => member.authUserId === otherUser,
    )!;
    expect(await members.findByIdAndTenantId(foreign.id, tenantA)).toBeNull();
    await expect(
      members.update({ ...foreign, isActive: false }, tenantA),
    ).rejects.toThrow('Resource not found');
    const users = new TypeOrmAuthUserRepository(helper);
    expect(await users.findByIdsAndTenantId([otherUser], tenantA)).toEqual([]);
    expect(
      (await users.findByIdsAndTenantId([user, otherUser], tenantA)).map(
        (row) => row.id,
      ),
    ).toEqual([user]);
    const invitationId = randomUUID();
    await admin.query(
      `INSERT INTO ${table('tenant_invitations')} (id,tenant_id,email,name,expires_at) VALUES ($1,$2,'invite@example.invalid','Invite',now()+interval '1 day')`,
      [invitationId, tenantB],
    );
    const invitations = new TypeOrmTenantInvitationRepository(helper);
    expect(
      await invitations.findByIdAndTenantId(invitationId, tenantA),
    ).toBeNull();
    const invitation = await invitations.findByIdAndTenantId(
      invitationId,
      tenantB,
    );
    await expect(
      invitations.update({ ...invitation!, status: 'revoked' }, tenantA),
    ).rejects.toThrow('Resource not found');
    const keyId = randomUUID();
    await admin.query(
      `INSERT INTO ${table('api_keys')} (id,tenant_id,name,environment,key_prefix,key_hash,scope) VALUES ($1,$2,'Fixture','test','test_fixture','fixture','full_access')`,
      [keyId, tenantB],
    );
    const keys = new TypeormApiKeyRepository(
      runtime.getRepository(ApiKeyOrmEntity),
    );
    expect(await keys.findByIdAndTenantId(keyId, tenantA)).toBeNull();
    const key = await keys.findByIdAndTenantId(keyId, tenantB);
    await expect(keys.remove(key!, tenantA)).rejects.toThrow(
      'Resource not found',
    );
    expect(await keys.findByIdAndTenantId(keyId, tenantB)).not.toBeNull();
    // Collision of a known ID cannot transfer a webhook's owner.
    const configs = new TypeOrmWebhookConfigRepository(
      runtime.getRepository(WebhookConfigEntity),
    );
    const config = await configs.findByIdAndTenantId(configB, tenantB);
    await expect(
      configs.save({ ...config!, tenantId: tenantA }, tenantA),
    ).rejects.toThrow();
    expect(
      (await configs.findByIdAndTenantId(configB, tenantB))?.tenantId,
    ).toBe(tenantB);
  });
  it('supports deferred invoice reservation followed by invoice insertion in one transaction', async () => {
    const invoice = randomUUID();
    await runWithTenant(tenantA, () =>
      runtime.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO ${table('credit_transactions')} (tenant_id,amount,type,reserved_invoice_id,is_reservation) VALUES ($1,-1,'invoice_authorized',$2,true)`,
          [tenantA, invoice],
        );
        await manager.query(
          `INSERT INTO ${table('nfse_invoices')} (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment) VALUES ($1,$2,$3,'queued','{}','{}','{}',10,'2026-10-11','test')`,
          [invoice, companyA, tenantA],
        );
      }),
    );
    expect(
      await runWithTenant(tenantA, () =>
        runtime.query(
          `SELECT reserved_invoice_id FROM ${table('credit_transactions')} WHERE reserved_invoice_id=$1`,
          [invoice],
        ),
      ),
    ).toEqual([{ reserved_invoice_id: invoice }]);
  });
  it.each(['reserved_invoice_id', 'period_id', 'related_transaction_id'])(
    'rejects credit %s references to another tenant even for a privileged writer',
    async (column) => {
      const id =
        column === 'reserved_invoice_id'
          ? invoiceB
          : column === 'period_id'
            ? periodB
            : creditB;
      await expect(
        admin.query(
          `INSERT INTO ${table('credit_transactions')} (tenant_id,amount,type,"${column}") VALUES ($1,1,'bonus',$2)`,
          [tenantA, id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    },
  );
  it('rejects webhook configurations belonging to another tenant', async () => {
    await expect(
      admin.query(
        `INSERT INTO ${table('webhook_deliveries')} (tenant_id,webhook_config_id,event_type,url,environment) VALUES ($1,$2,'webhook.test','https://example.invalid','test')`,
        [tenantA, configB],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('aborts reference migration on existing violations and reapplies after repair', async () => {
    const runner = admin.createQueryRunner();
    const migration = new EnforceTenantReferences1791740000000();
    const invalid = randomUUID();
    try {
      await migration.down(runner);
      await admin.query(
        `INSERT INTO ${table('credit_transactions')} (id,tenant_id,amount,type,period_id) VALUES ($1,$2,1,'bonus',$3)`,
        [invalid, tenantA, periodB],
      );
      await expect(migration.up(runner)).rejects.toThrow(
        'Tenant integrity violation',
      );
      await admin.query(
        `DELETE FROM ${table('credit_transactions')} WHERE id=$1`,
        [invalid],
      );
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });
  it('refuses a production runtime with a privileged role', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        new RlsConnectionScopeService(admin).onModuleInit(),
      ).rejects.toThrow('NOSUPERUSER NOBYPASSRLS');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
  it('can reverse and reapply RLS policies in the isolated schema', async () => {
    const runner = admin.createQueryRunner();
    const migration = new EnableTenantRls1791750000000();
    try {
      await migration.down(runner);
      await expect(
        new RlsConnectionScopeService(runtime).onModuleInit(),
      ).rejects.toThrow('RLS policies are missing');
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(
      await runtime.query(`SELECT id FROM ${table('nfse_invoices')}`),
    ).toEqual([]);
  });
});
