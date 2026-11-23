import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';
import { TypeOrmTenantRepository } from '@/modules/auth/infra/typeorm-tenant.repository';
import { CreditsService } from '@/modules/credits/application/credits.service';
import { TypeOrmCreditTransactionRepository } from '@/modules/credits/infra/typeorm-credit-transaction.repository';
import { PlatformCreditGrantService } from './application/platform-credit-grant.service';
import { PlatformAdminAuditRepository } from './infra/platform-admin-audit.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Credit grant integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pcg_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;

describePostgres('PlatformCreditGrantService on PostgreSQL (RLS role)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let service: PlatformCreditGrantService;
  let credits: CreditsService;
  let creditRepo: TypeOrmCreditTransactionRepository;
  let audit: PlatformAdminAuditRepository;
  let publish: jest.Mock;
  const cacheStore = new Map<string, unknown>();
  const table = (name: string) => `"${schema}"."${name}"`;
  const adminTenant = randomUUID();
  const actor = {
    authUserId: randomUUID(),
    email: 'admin@corvo.tech',
    ipHash: null,
  };
  const body = { amount: 10, reason: 'cortesia de teste', notifyUser: false };

  const newTenant = async () => {
    const id = randomUUID();
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [id]);
    return id;
  };
  /** Mimics the request: the interceptor scopes the admin's own tenant. */
  const asRequest = <T>(work: () => Promise<T>) =>
    runWithTenant(adminTenant, work);
  const grant = (tenant: string, key: string, input: typeof body = body) =>
    asRequest(() => service.grant(actor, tenant, input, key));
  const rows = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
    const out: T[] = await admin.query(sql, params);
    return out;
  };
  const bonusRows = (tenant: string) =>
    rows<{ metadata: unknown; description: string }>(
      `SELECT * FROM ${table('credit_transactions')} WHERE tenant_id=$1 AND type='bonus'`,
      [tenant],
    );
  const auditRows = (key: string) =>
    rows<{ success: boolean; reason: string }>(
      `SELECT * FROM ${table('platform_admin_audit_events')} WHERE idempotency_key=$1 ORDER BY created_at`,
      [key],
    );

  beforeAll(async () => {
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [
      adminTenant,
    ]);
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
      extra: { ...options.extra, max: 10 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    await new RlsConnectionScopeService(runtime).onModuleInit();

    const txContext = new TypeOrmTransactionContext();
    const helper = new TypeOrmRepositoryHelper(runtime, txContext);
    creditRepo = new TypeOrmCreditTransactionRepository(helper);
    const cache = {
      get: async (k: string) => (cacheStore.get(k) as never) ?? null,
      set: async (k: string, v: unknown) => void cacheStore.set(k, v),
      delete: async (k: string) => void cacheStore.delete(k),
    };
    credits = new CreditsService(cache as never, creditRepo);
    audit = new PlatformAdminAuditRepository(helper);
    publish = jest.fn();
    service = new PlatformCreditGrantService(
      new TypeOrmUnitOfWork(runtime, txContext),
      audit,
      credits,
      new TypeOrmTenantRepository(runtime.getRepository(TenantOrmEntity)),
      { publishBestEffort: publish } as never,
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

  it('concede num tenant que não é o do admin, com crédito e auditoria juntos', async () => {
    const tenant = await newTenant();
    const key = randomUUID();
    const result = await grant(tenant, key);
    expect(result).toEqual({
      tenantId: tenant,
      amount: 10,
      balance: 10,
      replayed: false,
    });
    expect(await bonusRows(tenant)).toHaveLength(1);
    const audits = await auditRows(key);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ success: true, reason: body.reason });
  });

  it('duas requisições paralelas com a mesma chave geram uma linha bonus e uma auditoria de sucesso', async () => {
    const tenant = await newTenant();
    const key = randomUUID();
    const results = await Promise.all([
      grant(tenant, key),
      grant(tenant, key),
      grant(tenant, key),
    ]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    for (const r of results)
      expect(r).toMatchObject({ amount: 10, balance: 10 });
    expect(await bonusRows(tenant)).toHaveLength(1);
    const audits = await auditRows(key);
    expect(audits.filter((a) => a.success)).toHaveLength(1);
    expect((await credits.getBalance(tenant)).balance).toBe(10);
  });

  it('repetição sequencial devolve o original; corpo diferente dá 409', async () => {
    const tenant = await newTenant();
    const key = randomUUID();
    await grant(tenant, key);
    await expect(grant(tenant, key)).resolves.toMatchObject({
      replayed: true,
      balance: 10,
    });
    await expect(
      grant(tenant, key, { ...body, amount: 11 }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(await bonusRows(tenant)).toHaveLength(1);
    const audits = await auditRows(key);
    expect(audits.filter((a) => !a.success)).toHaveLength(1);
  });

  it('GET /credits/history do cliente não contém o motivo nem o e-mail do admin', async () => {
    const tenant = await newTenant();
    const reason = 'motivo secreto da cortesia';
    await grant(tenant, randomUUID(), { ...body, reason });
    const history = JSON.stringify(await creditRepo.findByTenantId(tenant));
    expect(history).toContain('platform_admin');
    expect(history).not.toContain(reason);
    expect(history).not.toContain(actor.email);
    const [row] = await bonusRows(tenant);
    expect(row.description).toBe('Notas cedidas pela Corvo');
  });

  it('a concessão não altera a receita do overview (nenhum pagamento é criado)', async () => {
    const tenant = await newTenant();
    await grant(tenant, randomUUID());
    const [{ n }] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table('payment_intents')} WHERE tenant_id=$1`,
      [tenant],
    );
    expect(n).toBe(0);
  });

  it('rollback por falha na auditoria deixa saldo e cache iguais ao de antes', async () => {
    const tenant = await newTenant();
    await grant(tenant, randomUUID()); // balance 10
    const before = await credits.getBalance(tenant);
    const key = randomUUID();
    const spy = jest
      .spyOn(audit, 'insert')
      .mockRejectedValueOnce(new Error('audit down'));
    await expect(grant(tenant, key)).rejects.toThrow('audit down');
    spy.mockRestore();

    expect(await bonusRows(tenant)).toHaveLength(1);
    expect((await credits.getBalance(tenant)).balance).toBe(before.balance);
    expect(await creditRepo.calculateBalance(tenant)).toBe(10);
    const audits = await auditRows(key);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ success: false });
  });

  it('tenant inexistente: 404 e linha de falha', async () => {
    const key = randomUUID();
    await expect(grant(randomUUID(), key)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect((await auditRows(key))[0]).toMatchObject({ success: false });
  });

  it('notifyUser publica uma vez após o commit e não na repetição', async () => {
    const tenant = await newTenant();
    const key = randomUUID();
    publish.mockClear();
    await grant(tenant, key, { ...body, notifyUser: true });
    await grant(tenant, key, { ...body, notifyUser: true });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
