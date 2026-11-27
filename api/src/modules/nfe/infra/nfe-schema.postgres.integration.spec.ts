import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { entityDrift } from '@/infra/database/testing/entity-drift';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('NF-e schema tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_schema_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const documentA = randomUUID();
const documentB = randomUUID();

const TABLES = [
  'nfe_documents',
  'nfe_document_items',
  'nfe_document_history',
  'nfe_document_events',
  'nfe_number_sequences',
  'nfe_inutilizations',
] as const;

describePostgres('NF-e schema with real PostgreSQL', () => {
  let admin: DataSource;
  let runtime: DataSource;
  const q = (sql: string) => sql.replaceAll('$S', `"${schema}"`);

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(q(`INSERT INTO $S.tenants (id) VALUES ($1),($2)`), [
      tenantA,
      tenantB,
    ]);
    for (const [tenant, company, taxId] of [
      [tenantA, companyA, '11222333000181'],
      [tenantB, companyB, '11222333000182'],
    ] as const)
      await admin.query(
        q(
          `INSERT INTO $S.nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture',$3,'test')`,
        ),
        [company, tenant, taxId],
      );
    for (const [tenant, company, id, key] of [
      [tenantA, companyA, documentA, 'key-a'],
      [tenantB, companyB, documentB, 'key-b'],
    ] as const) {
      await admin.query(
        q(
          `INSERT INTO $S.nfe_documents (id,tenant_id,company_id,environment,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash)
           VALUES ($1,$2,$3,'test','Venda',1,'{}','{}','{}',$4,repeat('a',64))`,
        ),
        [id, tenant, company, key],
      );
      await admin.query(
        q(
          `INSERT INTO $S.nfe_document_items (document_id,n_item,tenant_id,code,description,ncm,cfop,unit,quantity,unit_price,total,origin,csosn,pis_cst,cofins_cst)
           VALUES ($1,1,$2,'SKU','Item','12345678','5102','UN',1,1,1,0,'102','49','49')`,
        ),
        [id, tenant],
      );
      await admin.query(
        q(
          `INSERT INTO $S.nfe_document_history (tenant_id,document_id,to_status) VALUES ($1,$2,'queued')`,
        ),
        [tenant, id],
      );
      await admin.query(
        q(
          `INSERT INTO $S.nfe_document_events (tenant_id,document_id,tp_evento,n_seq) VALUES ($1,$2,'110110',1)`,
        ),
        [tenant, id],
      );
      await admin.query(
        q(
          `INSERT INTO $S.nfe_number_sequences (tenant_id,company_id,model,series,current_number) VALUES ($1,$2,55,1,5)`,
        ),
        [tenant, company],
      );
      await admin.query(
        q(
          `INSERT INTO $S.nfe_inutilizations (tenant_id,company_id,environment,series,start_number,end_number,justification) VALUES ($1,$2,'test',1,1,2,'Numeração pulada por erro')`,
        ),
        [tenant, company],
      );
    }

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
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('creates the six tables', async () => {
    const rows: Array<{ table_name: string }> = await admin.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'nfe\\_%'`,
      [schema],
    );
    const found = rows.map((r) => r.table_name);
    for (const table of TABLES) expect(found).toContain(table);
  });

  it('keeps the entities and the migrations in agreement', async () => {
    expect(await entityDrift(admin)).toEqual([]);
  });

  it.each(TABLES)('isolates tenants by RLS on %s', async (table) => {
    const own = await runWithTenant(
      tenantA,
      (): Promise<Array<{ tenant_id: string }>> =>
        runtime.query(q(`SELECT tenant_id FROM $S.${table}`)),
    );
    expect(own.length).toBeGreaterThan(0);
    expect(
      (own as Array<{ tenant_id: string }>).every(
        (r) => r.tenant_id === tenantA,
      ),
    ).toBe(true);
    const none = await runWithTenant(tenantB, () =>
      runtime.query(
        q(`SELECT tenant_id FROM $S.${table} WHERE tenant_id = $1`),
        [tenantA],
      ),
    );
    expect(none).toEqual([]);
  });

  it('refuses a row written for another tenant', async () => {
    await expect(
      runWithTenant(tenantB, () =>
        runtime.query(
          q(
            `INSERT INTO $S.nfe_number_sequences (tenant_id,company_id,model,series) VALUES ($1,$2,55,9)`,
          ),
          [tenantA, companyA],
        ),
      ),
    ).rejects.toBeDefined();
  });

  it('refuses a repeated (company, model, series, number)', async () => {
    const insert = (key: string) =>
      admin.query(
        q(
          `INSERT INTO $S.nfe_documents (tenant_id,company_id,environment,series,number,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash)
           VALUES ($1,$2,'test',1,10,'Venda',1,'{}','{}','{}',$3,repeat('b',64))`,
        ),
        [tenantA, companyA, key],
      );
    await insert('number-1');
    await expect(insert('number-2')).rejects.toThrow(/uq_nfe_documents_number/);
  });

  it('refuses a repeated idempotency key in the same tenant and environment', async () => {
    await expect(
      admin.query(
        q(
          `INSERT INTO $S.nfe_documents (tenant_id,company_id,environment,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash)
           VALUES ($1,$2,'test','Venda',1,'{}','{}','{}','key-a',repeat('c',64))`,
        ),
        [tenantA, companyA],
      ),
    ).rejects.toThrow(/uq_nfe_documents_idempotency/);
  });

  it('refuses a repeated access key in the same environment', async () => {
    const key = '3'.repeat(44);
    const insert = (idem: string) =>
      admin.query(
        q(
          `INSERT INTO $S.nfe_documents (tenant_id,company_id,environment,access_key,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash)
           VALUES ($1,$2,'test',$3,'Venda',1,'{}','{}','{}',$4,repeat('d',64))`,
        ),
        [tenantA, companyA, key, idem],
      );
    await insert('ak-1');
    await expect(insert('ak-2')).rejects.toThrow(/uq_nfe_documents_access_key/);
  });

  it('refuses an inutilization whose start is after its end', async () => {
    await expect(
      admin.query(
        q(
          `INSERT INTO $S.nfe_inutilizations (tenant_id,company_id,environment,series,start_number,end_number,justification) VALUES ($1,$2,'test',1,5,4,'Numeração pulada por erro')`,
        ),
        [tenantA, companyA],
      ),
    ).rejects.toThrow(/ck_nfe_inutilizations_range/);
  });

  it('refuses a company of another tenant', async () => {
    await expect(
      admin.query(
        q(
          `INSERT INTO $S.nfe_documents (tenant_id,company_id,environment,nat_op,id_dest,recipient,totals,payment,idempotency_key,request_hash)
           VALUES ($1,$2,'test','Venda',1,'{}','{}','{}','cross',repeat('e',64))`,
        ),
        [tenantA, companyB],
      ),
    ).rejects.toThrow(/fk_nfe_documents_company/);
  });
});
