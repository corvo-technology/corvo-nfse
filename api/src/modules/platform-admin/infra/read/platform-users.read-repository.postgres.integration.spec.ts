import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { PlatformReadSession } from '../platform-read-session';
import { PlatformUsersReadRepository } from './platform-users.read-repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Platform users integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pru_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;

describePostgres('PlatformUsersReadRepository (PostgreSQL)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: PlatformUsersReadRepository;
  const table = (name: string) => `"${schema}"."${name}"`;

  async function addUser(
    email: string,
    name: string,
    createdAt: string,
    lastLoginAt: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO ${table('auth_users')} (id,email,name,created_at,last_login_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, email, name, createdAt, lastLoginAt],
    );
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [id]);
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$1,'admin')`,
      [id],
    );
    return id;
  }

  async function addCompany(
    tenantId: string,
    taxId: string,
    environment = 'live',
  ): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment,status)
       VALUES ($1,$2,'Empresa X',$3,$4,'ready')`,
      [id, tenantId, taxId, environment],
    );
    return id;
  }

  async function addInvoice(
    tenantId: string,
    companyId: string,
    createdAt: string,
    status = 'authorized',
    environment = 'live',
  ): Promise<void> {
    await admin.query(
      `INSERT INTO ${table('nfse_invoices')}
         (id,tenant_id,company_id,environment,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,created_at)
       VALUES ($1,$2,$3,$4,$5,'{}','{}','{}',10,'2026-11-01',$6)`,
      [randomUUID(), tenantId, companyId, environment, status, createdAt],
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
    await admin.query(`ALTER ROLE "${role}" SET search_path = "${schema}"`);
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
    repo = new PlatformUsersReadRepository(new PlatformReadSession(runtime));
  }, 180000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    await admin.query(
      `TRUNCATE ${table('auth_users')}, ${table('tenants')} CASCADE`,
    );
  });

  it('buscar "%" não devolve todo mundo', async () => {
    await addUser('ana@example.com', 'Ana', '2026-11-01T10:00:00Z');
    await addUser('bia@example.com', 'Bia', '2026-11-02T10:00:00Z');
    await addUser('100%@example.com', 'Cem', '2026-11-03T10:00:00Z');
    const page = await repo.list({ search: '%', limit: 50 });
    expect(page.data.map((u) => u.email)).toEqual(['100%@example.com']);
    const underscore = await repo.list({ search: '_', limit: 50 });
    expect(underscore.data).toHaveLength(0);
  });

  it('buscar o CNPJ com máscara acha a empresa; buscar por parte do e-mail e do nome acha o usuário', async () => {
    const ana = await addUser(
      'ana@example.com',
      'Ana Souza',
      '2026-11-01T10:00:00Z',
    );
    await addUser('bia@example.com', 'Bia', '2026-11-02T10:00:00Z');
    await addCompany(ana, '12345678000195');
    expect(
      (await repo.list({ search: '12.345.678/0001-95', limit: 50 })).data.map(
        (u) => u.id,
      ),
    ).toEqual([ana]);
    expect(
      (await repo.list({ search: '12.345', limit: 50 })).data.map((u) => u.id),
    ).toEqual([ana]);
    expect(
      (await repo.list({ search: 'ANA@exam', limit: 50 })).data.map(
        (u) => u.id,
      ),
    ).toEqual([ana]);
    expect(
      (await repo.list({ search: 'souza', limit: 50 })).data.map((u) => u.id),
    ).toEqual([ana]);
    expect(
      (await repo.list({ search: 'x'.repeat(100), limit: 50 })).data,
    ).toHaveLength(0);
  });

  it('paginação por cursor não repete nem perde usuários com o mesmo created_at', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        await addUser(
          `u${i}@example.com`,
          `U${i}`,
          '2026-11-01T10:00:00.123456Z',
        ),
      );
    ids.push(
      await addUser('later@example.com', 'Later', '2026-11-05T10:00:00Z'),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await repo.list({ limit: 2, cursor });
      seen.push(...page.data.map((u) => u.id));
      if (!page.pagination.hasMore) break;
      cursor = page.pagination.nextCursor!;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('lastActivityAt escolhe o maior entre nota, chave, MCP e login', async () => {
    const u = await addUser(
      'ana@example.com',
      'Ana',
      '2026-11-01T10:00:00Z',
      '2026-11-02T00:00:00Z',
    );
    const company = await addCompany(u, '12345678000195');
    await addInvoice(u, company, '2026-11-03T00:00:00Z');
    await admin.query(
      `INSERT INTO ${table('api_keys')} (id,tenant_id,name,environment,key_prefix,key_hash,scope,last_used_at)
       VALUES ($1,$2,'k','live',$3,'h','admin','2026-11-04T00:00:00Z')`,
      [randomUUID(), u, `cv_${randomUUID()}`],
    );
    let row = (await repo.list({ limit: 50 })).data[0];
    expect(row.lastActivityAt).toBe('2026-11-04T00:00:00.000Z');
    await admin.query(
      `UPDATE ${table('auth_users')} SET last_login_at='2026-11-09T00:00:00Z' WHERE id=$1`,
      [u],
    );
    row = (await repo.list({ limit: 50 })).data[0];
    expect(row.lastActivityAt).toBe('2026-11-09T00:00:00.000Z');
  });

  it('colunas derivadas: plano, notas live do mês, saldo avulso e empresas', async () => {
    const u = await addUser('ana@example.com', 'Ana', '2026-11-01T10:00:00Z');
    const [plan]: Array<{ id: string; slug: string }> = await admin.query(
      `SELECT id, slug FROM ${table('plans')} LIMIT 1`,
    );
    await admin.query(`UPDATE ${table('tenants')} SET plan_id=$1 WHERE id=$2`, [
      plan.id,
      u,
    ]);
    const company = await addCompany(u, '12345678000195');
    const now = new Date().toISOString();
    await addInvoice(u, company, now);
    await addInvoice(u, company, now, 'rejected');
    const testCompany = await addCompany(u, '98765432000100', 'test');
    await addInvoice(u, testCompany, now, 'authorized', 'test');
    await addInvoice(u, company, '2020-01-01T00:00:00Z');
    await admin.query(
      `INSERT INTO ${table('credit_transactions')} (id,tenant_id,amount,type) VALUES ($1,$2,7,'bonus'),($3,$2,-2,'usage')`,
      [randomUUID(), u, randomUUID()],
    );
    const [row] = (await repo.list({ limit: 50 })).data;
    expect(row).toMatchObject({
      planSlug: plan.slug,
      liveInvoicesThisMonth: 1,
      avulsoBalance: 5,
      companiesCount: 2,
    });
  });
});
