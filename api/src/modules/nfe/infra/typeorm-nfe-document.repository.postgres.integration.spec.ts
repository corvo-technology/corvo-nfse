import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { TypeOrmNfeDocumentRepository } from './typeorm-nfe-document.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('NF-e repository tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_repo_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();

describePostgres('NfeDocument repository with a restricted role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmNfeDocumentRepository;
  const transactions = new TypeOrmTransactionContext();

  const newDoc = (overrides: Parameters<typeof documentParams>[0] = {}) =>
    NfeDocument.create(
      documentParams({ tenantId: tenantA, companyId: companyA, ...overrides }),
    );

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
    for (const [tenant, company, taxId] of [
      [tenantA, companyA, '11222333000181'],
      [tenantB, companyB, '11222333000182'],
    ] as const)
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,'test')`,
        [company, tenant, taxId],
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
    repo = new TypeOrmNfeDocumentRepository(
      new TypeOrmRepositoryHelper(runtime, transactions),
    );
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('stores a document with its items and reads it back unchanged', async () => {
    const doc = newDoc({
      items: [
        {
          ...documentParams().items[0],
          nItem: 1,
          quantity: '1.3333',
          unitPrice: '0.3333333333',
          total: '0.44',
        },
        { ...documentParams().items[0], nItem: 2, code: 'SKU2' },
      ],
    });
    await repo.insert(doc);
    const found = await repo.findById(doc.id, tenantA, 'test');
    expect(found?.toSnapshot()).toEqual(doc.toSnapshot());
    expect(found?.toSnapshot().items[0]).toMatchObject({
      quantity: '1.3333',
      unitPrice: '0.3333333333',
      total: '0.44',
    });
  });

  it('saves the numbering, the key and the new status', async () => {
    const doc = newDoc();
    await repo.insert(doc);
    doc.transitionTo('processing');
    doc.assignNumber(1, 41);
    doc.startAttempt('12345678', '3'.repeat(44), '<NFe/>', new Date());
    await repo.save(doc);
    const found = await repo.findById(doc.id, tenantA, 'test');
    expect(found?.toSnapshot()).toMatchObject({
      status: 'processing',
      series: 1,
      number: 41,
      attempt: 1,
      cNf: '12345678',
      accessKey: '3'.repeat(44),
      signedXml: '<NFe/>',
    });
    expect(await repo.findByAccessKey('3'.repeat(44), tenantA, 'test')).not.toBeNull();
    expect(await repo.findByAccessKey('3'.repeat(44), tenantA, 'live')).toBeNull();
  });

  it('finds by idempotency key within the tenant and environment', async () => {
    const doc = newDoc({ idempotencyKey: 'idem-lookup' });
    await repo.insert(doc);
    expect((await repo.findByIdempotencyKey('idem-lookup', tenantA, 'test'))?.id).toBe(
      doc.id,
    );
    expect(await repo.findByIdempotencyKey('idem-lookup', tenantA, 'live')).toBeNull();
  });

  it('keeps the history in the order the transitions happened', async () => {
    const doc = newDoc();
    await repo.insert(doc);
    await repo.appendHistory(doc.transitionTo('processing'));
    doc.startAttempt('12345678', '5'.repeat(44), '<NFe/>', new Date());
    await repo.appendHistory(doc.transitionTo('rejected', { cStat: '225' }));
    await repo.appendHistory(doc.transitionTo('queued'));
    const history = await repo.history(doc.id, tenantA);
    expect(history.map((h) => h.toStatus)).toEqual([
      'processing',
      'rejected',
      'queued',
    ]);
    expect(history[1]).toMatchObject({ accessKey: '5'.repeat(44), attempt: 1, cStat: '225' });
  });

  it("does not show one tenant's document to another tenant", async () => {
    const doc = newDoc();
    await repo.insert(doc);
    expect(await repo.findById(doc.id, tenantB, 'test')).toBeNull();
    expect(await repo.findById(doc.id, tenantA, 'live')).toBeNull();
  });

  it('refuses a document of a company that belongs to another tenant', async () => {
    await expect(repo.insert(newDoc({ companyId: companyB }))).rejects.toBeDefined();
  });

  it('locks the row inside a transaction', async () => {
    const doc = newDoc();
    await repo.insert(doc);
    const locked = await runWithTenant(tenantA, () =>
      runtime.transaction((manager) =>
        transactions.run(manager, () =>
          repo.findById(doc.id, tenantA, 'test', { forUpdate: true }),
        ),
      ),
    );
    expect(locked?.id).toBe(doc.id);
  });

  it('pages newest first with a cursor, filtering by company and status', async () => {
    const other = randomUUID();
    await admin.query(
      `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Other','11222333000199','test')`,
      [other, tenantA],
    );
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const doc = newDoc({ companyId: other });
      await repo.insert(doc);
      created.push(doc.id);
    }
    const first = await repo.list(tenantA, 'test', { companyId: other, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.data[0].toSnapshot().items).toHaveLength(1);
    const second = await repo.list(tenantA, 'test', {
      companyId: other,
      limit: 2,
      cursor: first.pagination.nextCursor ?? undefined,
    });
    expect(second.data).toHaveLength(1);
    expect(second.pagination.hasMore).toBe(false);
    expect(
      [...first.data, ...second.data].map((d) => d.id).sort(),
    ).toEqual([...created].sort());
    const queued = await repo.list(tenantA, 'test', {
      companyId: other,
      status: 'authorized',
    });
    expect(queued.data).toEqual([]);
  });
});
