import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);
const schema = `integ_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();

describePostgres('integration tables on real PostgreSQL', () => {
  let db: DataSource;
  const t = (name: string) => `"${schema}"."${name}"`;

  async function connection(
    tenant: string,
    company: string,
    over: { publicId?: string; account?: string | null; state?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO ${t('integration_connections')} (id,tenant_id,company_id,public_id,provider,environment,external_account_id,state,credentials_enc) VALUES ($1,$2,$3,$4,'woovi','test',$5,$6,'enc')`,
      [
        id,
        tenant,
        company,
        over.publicId ?? randomUUID().replaceAll('-', ''),
        over.account === undefined ? randomUUID() : over.account,
        over.state ?? 'active',
      ],
    );
    return id;
  }

  const insertEvent = (tenant: string, conn: string, delivery: string) =>
    db.query(
      `INSERT INTO ${t('integration_events')} (tenant_id,connection_id,provider,environment,external_account_id,delivery_id,external_type,payload_enc) VALUES ($1,$2,'woovi','test','acc',$3,'x','enc')`,
      [tenant, conn, delivery],
    );

  const insertOperation = (tenant: string, conn: string, key: string) =>
    db.query(
      `INSERT INTO ${t('integration_operations')} (tenant_id,connection_id,provider,environment,external_account_id,operation_key,commercial_state,snapshot) VALUES ($1,$2,'woovi','test','acc',$3,'paid','{}')`,
      [tenant, conn, key],
    );

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const [company, tenant] of [
      [companyA, tenantA],
      [companyB, tenantB],
    ])
      await db.query(
        `INSERT INTO ${t('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
        [company, tenant],
      );
    await db.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await db.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await db.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
    );
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.query(`DROP ROLE IF EXISTS "${role}"`);
    await db.destroy();
  });

  it('creates the four tables with row level security forced', async () => {
    const rows: Array<{ relname: string; relforcerowsecurity: boolean }> =
      await db.query(
        `SELECT c.relname, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname LIKE 'integration_%' AND c.relkind='r'`,
        [schema],
      );
    expect(rows.map((r) => r.relname).sort()).toEqual([
      'integration_connections',
      'integration_events',
      'integration_operations',
      'integration_rules',
    ]);
    expect(rows.every((r) => r.relforcerowsecurity)).toBe(true);
  });

  it('rejects a second delivery with the same (tenant, environment, provider, account, delivery_id)', async () => {
    const conn = await connection(tenantA, companyA);
    await insertEvent(tenantA, conn, 'd-1');
    await expect(insertEvent(tenantA, conn, 'd-1')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('rejects a second operation with the same operation_key for the same account', async () => {
    const conn = await connection(tenantA, companyA);
    await insertOperation(tenantA, conn, 'charge:1');
    await expect(
      insertOperation(tenantA, conn, 'charge:1'),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses a connection reference that belongs to another tenant', async () => {
    const conn = await connection(tenantA, companyA);
    await expect(insertEvent(tenantB, conn, 'x-1')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('rejects two live connections for the same (provider, environment, account) and allows reconnecting after disconnect', async () => {
    const account = randomUUID();
    const first = await connection(tenantA, companyA, { account });
    await expect(
      connection(tenantB, companyB, { account }),
    ).rejects.toMatchObject({ code: '23505' });
    await db.query(
      `UPDATE ${t('integration_connections')} SET state='disconnected' WHERE id=$1`,
      [first],
    );
    await expect(connection(tenantA, companyA, { account })).resolves.toEqual(
      expect.any(String),
    );
  });

  it('keeps one default rule per connection and one per product', async () => {
    const conn = await connection(tenantA, companyA);
    const rule = (product: string | null) =>
      db.query(
        `INSERT INTO ${t('integration_rules')} (tenant_id,connection_id,external_product_id,service) VALUES ($1,$2,$3,'{}')`,
        [tenantA, conn, product],
      );
    await rule(null);
    await expect(rule(null)).rejects.toMatchObject({ code: '23505' });
    await rule('p1');
    await expect(rule('p1')).rejects.toMatchObject({ code: '23505' });
  });

  it("hides another tenant's rows from a non-privileged role", async () => {
    const conn = await connection(tenantB, companyB);
    const runner = db.createQueryRunner();
    await runner.startTransaction();
    try {
      await runner.query(`SET LOCAL ROLE "${role}"`);
      await runner.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [tenantA],
      );
      const rows = await runner.query(
        `SELECT id FROM ${t('integration_connections')} WHERE id=$1`,
        [conn],
      );
      expect(rows).toHaveLength(0);
      await runner.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [tenantB],
      );
      const own = await runner.query(
        `SELECT id FROM ${t('integration_connections')} WHERE id=$1`,
        [conn],
      );
      expect(own).toHaveLength(1);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
