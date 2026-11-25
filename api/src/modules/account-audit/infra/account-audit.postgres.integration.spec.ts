import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmAccountAuditRepository } from './typeorm-account-audit.repository';
import type { AuditEventFilters, NewAuditRow } from '../domain/account-audit';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `audit_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();

describePostgres('account_audit_events (RLS integration)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repository: TypeOrmAccountAuditRepository;
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
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
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
    repository = new TypeOrmAccountAuditRepository(runtime);
  }, 60000);

  afterEach(async () => {
    await admin.query(`DELETE FROM ${table('account_audit_events')}`);
  });

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  const row = (
    tenantId: string,
    overrides: Partial<NewAuditRow> = {},
  ): NewAuditRow => ({
    tenantId,
    environment: 'live',
    action: 'company.created',
    actorType: 'user',
    actorId: 'u1',
    actorLabel: 'Maria',
    actorOnBehalfOfLabel: null,
    targetType: 'company',
    targetId: 'c1',
    targetLabel: 'Empresa',
    metadata: { units: 3 },
    ipHash: null,
    ...overrides,
  });
  const at = (
    tenantId: string,
    when: string,
    overrides: Partial<NewAuditRow> = {},
  ) =>
    repository
      .insert(row(tenantId, overrides))
      .then(() =>
        admin.query(
          `UPDATE ${table('account_audit_events')} SET occurred_at = $1 WHERE id = (SELECT id FROM ${table('account_audit_events')} WHERE tenant_id = $2 ORDER BY occurred_at DESC LIMIT 1)`,
          [when, tenantId],
        ),
      );
  const list = (
    tenantId: string,
    environment: 'test' | 'live',
    filters: AuditEventFilters = {},
    options: { limit?: number; cursor?: string } = {},
  ) => repository.listPage(tenantId, environment, filters, options);

  it('a tenant only lists its own events', async () => {
    await repository.insert(row(tenantA));
    await repository.insert(row(tenantB, { actorLabel: 'Outro' }));
    const page = await list(tenantA, 'live');
    expect(page.data).toHaveLength(1);
    expect(page.data[0].actor.label).toBe('Maria');
    const scoped = await runWithTenant(tenantA, () =>
      runtime.query(
        `SELECT count(*)::int AS n FROM ${table('account_audit_events')}`,
      ),
    );
    expect((scoped as Array<{ n: number }>)[0].n).toBe(1);
  });

  it('refuses to write another tenant row', async () => {
    await expect(
      runWithTenant(tenantA, () =>
        runtime.query(
          `INSERT INTO ${table('account_audit_events')} (tenant_id, actor_type, actor_label, action) VALUES ($1,'user','x','company.created')`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow();
  });

  it('the runtime role cannot update an event', async () => {
    await repository.insert(row(tenantA));
    const result = await runWithTenant(tenantA, () =>
      runtime.query(
        `UPDATE ${table('account_audit_events')} SET actor_label = 'Hacked' WHERE tenant_id = $1`,
        [tenantA],
      ),
    );
    const affected = Array.isArray(result) ? (result[1] as number) : 0;
    expect(affected).toBe(0);
    const page = await list(tenantA, 'live');
    expect(page.data[0].actor.label).toBe('Maria');
  });

  it('lists current environment plus account-level events, newest first, with a working cursor', async () => {
    await at(tenantA, '2026-11-01T10:00:00Z', { actorLabel: 'live-old' });
    await at(tenantA, '2026-11-02T10:00:00Z', {
      environment: null,
      actorLabel: 'account',
    });
    await at(tenantA, '2026-11-03T10:00:00Z', {
      environment: 'test',
      actorLabel: 'test-env',
    });
    await at(tenantA, '2026-11-04T10:00:00Z', { actorLabel: 'live-new' });
    const first = await list(tenantA, 'live', {}, { limit: 2 });
    expect(first.data.map((e) => e.actor.label)).toEqual([
      'live-new',
      'account',
    ]);
    expect(first.pagination.hasMore).toBe(true);
    const second = await list(
      tenantA,
      'live',
      {},
      { limit: 2, cursor: first.pagination.nextCursor! },
    );
    expect(second.data.map((e) => e.actor.label)).toEqual(['live-old']);
    expect(second.pagination.hasMore).toBe(false);
  });

  it('filters by actor_type and period', async () => {
    await at(tenantA, '2026-11-01T10:00:00Z', { actorType: 'user' });
    await at(tenantA, '2026-11-10T10:00:00Z', {
      actorType: 'agent',
      actorLabel: 'Claude',
    });
    await at(tenantA, '2026-11-20T10:00:00Z', {
      actorType: 'agent',
      actorLabel: 'Claude 2',
    });
    const agents = await list(tenantA, 'live', { actorType: 'agent' });
    expect(agents.data.map((e) => e.actor.label)).toEqual([
      'Claude 2',
      'Claude',
    ]);
    const window = await list(tenantA, 'live', {
      from: new Date('2026-11-05T00:00:00Z'),
      to: new Date('2026-11-15T00:00:00Z'),
    });
    expect(window.data.map((e) => e.actor.label)).toEqual(['Claude']);
  });

  it('deleteOlderThan removes only rows older than the cutoff of that tenant', async () => {
    await at(tenantA, '2025-01-01T00:00:00Z');
    await at(tenantA, '2026-11-01T00:00:00Z');
    await at(tenantB, '2025-01-01T00:00:00Z');
    const removed = await repository.deleteOlderThan(
      tenantA,
      new Date('2025-11-24T00:00:00Z'),
    );
    expect(removed).toBe(1);
    expect((await list(tenantA, 'live')).data).toHaveLength(1);
    const counted: Array<{ n: number }> = await admin.query(
      `SELECT count(*)::int AS n FROM ${table('account_audit_events')} WHERE tenant_id = $1`,
      [tenantB],
    );
    expect(counted[0].n).toBe(1);
  });

  it('rejects metadata above 4 KB', async () => {
    await expect(
      repository.insert(
        row(tenantA, {
          metadata: Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`k${i}`, 'x'.repeat(300)]),
          ),
        }),
      ),
    ).rejects.toThrow();
  });
});
