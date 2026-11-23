import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmPortalSyncRepository } from './typeorm-portal-sync.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `psync_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const targetA = { companyId: companyA, environment: 'live' as const };
const document = (nsu: number) => ({
  nsu,
  accessKey: 'K'.repeat(50),
  documentType: 'EVENTO',
  eventType: 'CANCELAMENTO',
  xml: '<evento/>',
  generatedAt: new Date('2026-11-01T00:00:00Z'),
});

describePostgres('portal sync repository with restricted role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repository: TypeOrmPortalSyncRepository;

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const [id, tenant] of [
      [companyA, tenantA],
      [companyB, tenantB],
    ])
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','live')`,
        [id, tenant],
      );
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    if (!owner) throw new Error('Migration owner was not returned');
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
    repository = new TypeOrmPortalSyncRepository(runtime);
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('keeps a cursor per company and environment, and moves it', async () => {
    await repository.createCursor(tenantA, targetA, new Date('2026-11-11'));
    // A second create keeps the first.
    await repository.createCursor(tenantA, targetA, new Date('2030-01-01'));
    await repository.updateCursor(tenantA, targetA, { lastNsu: 42 });
    expect(await repository.findCursor(tenantA, targetA)).toMatchObject({
      lastNsu: 42,
      firstRoundDoneAt: null,
      nextRunAt: new Date('2026-11-11'),
    });
  });

  it('stores one row per NSU: writing it again changes nothing', async () => {
    await repository.saveDocument(tenantA, targetA, document(1));
    await repository.saveDocument(tenantA, targetA, document(1));
    await repository.saveDocument(tenantA, targetA, document(2));
    const pending = await repository.listUnprocessed(tenantA, targetA, 5, 10);
    expect(pending.map((d) => d.nsu)).toEqual([1, 2]);
  });

  it('marks documents processed, and gives up after the attempts', async () => {
    const [first, second] = await repository.listUnprocessed(
      tenantA,
      targetA,
      5,
      10,
    );
    await repository.markProcessed(tenantA, first.id);
    for (let i = 0; i < 5; i++)
      await repository.markFailed(tenantA, second.id, 'unreadable');
    expect(await repository.listUnprocessed(tenantA, targetA, 5, 10)).toEqual(
      [],
    );
  });

  it('lists only companies with an active certificate that has not expired', async () => {
    expect(await repository.listTargets(tenantA)).toEqual([]);
    await admin.query(
      `INSERT INTO "${schema}".nfse_certificates (company_id,serial_number,issuer,subject,fingerprint,valid_from,valid_until,status,encrypted_blob,encrypted_dek,dek_iv)
       VALUES ($1,'1','i','s','f',now() - interval '1 day',now() + interval '30 days','active','\\x00','\\x00','\\x00')`,
      [companyA],
    );
    expect(await repository.listTargets(tenantA)).toEqual([
      { companyId: companyA, environment: 'live' },
    ]);
  });

  it('never shows or touches another workspace', async () => {
    expect(await repository.findCursor(tenantB, targetA)).toBeNull();
    expect(await repository.listTargets(tenantB)).toEqual([]);
    expect(await repository.listUnprocessed(tenantB, targetA, 5, 10)).toEqual(
      [],
    );
    // A write scoped to workspace B cannot land a row for workspace A's company.
    await expect(
      repository.saveDocument(tenantB, targetA, document(9)),
    ).rejects.toThrow();
    const rows: unknown[] = await admin.query(
      `SELECT 1 FROM "${schema}".portal_documents WHERE nsu = 9`,
    );
    expect(rows).toHaveLength(0);
  });
});
