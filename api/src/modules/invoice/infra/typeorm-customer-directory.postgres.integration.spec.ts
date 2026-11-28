import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import type { CustomerScope } from '../domain/customer-directory';
import { TypeOrmCustomerDirectory } from './typeorm-customer-directory';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `cust_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const live = (tenantId: string): CustomerScope => ({
  tenantId,
  environment: 'live',
});
const CNPJ = '11222333000181';
const CPF = '52998224725';

describePostgres('customer directory with restricted role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let directory: TypeOrmCustomerDirectory;

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
    directory = new TypeOrmCustomerDirectory(runtime);
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('remembers a customer and finds it by document', async () => {
    await directory.remember(live(tenantA), {
      taxId: CNPJ,
      name: 'Acme Ltda',
      email: 'financeiro@acme.test',
    });
    expect(await directory.find(live(tenantA), CNPJ)).toMatchObject({
      taxId: CNPJ,
      name: 'Acme Ltda',
      email: 'financeiro@acme.test',
    });
  });

  it('keeps one row per document and never replaces a saved name or email with what an invoice carries', async () => {
    await directory.remember(live(tenantA), { taxId: CNPJ, name: 'Acme S.A.' });
    await directory.remember(live(tenantA), {
      taxId: CNPJ,
      name: 'ACME',
      email: 'outro@acme.test',
    });
    await directory.remember(live(tenantA), {
      taxId: CNPJ,
      name: 'Acme',
      email: '',
    });
    const saved = await directory.find(live(tenantA), CNPJ);
    expect(saved).toMatchObject({
      name: 'Acme Ltda',
      email: 'financeiro@acme.test',
    });
    const listed = await directory.list(
      live(tenantA),
      {},
      { limit: 50, offset: 0 },
    );
    expect(listed.items.filter((c) => c.taxId === CNPJ)).toHaveLength(1);
  });

  it('fills an empty saved email from an invoice, and an explicit edit still wins', async () => {
    await directory.remember(live(tenantA), { taxId: CPF, name: 'Maria' });
    expect((await directory.find(live(tenantA), CPF))?.email).toBeNull();
    await directory.remember(live(tenantA), {
      taxId: CPF,
      name: 'Maria Z',
      email: 'maria@x.test',
    });
    expect(await directory.find(live(tenantA), CPF)).toMatchObject({
      name: 'Maria',
      email: 'maria@x.test',
    });
    await directory.update(live(tenantA), CPF, {
      name: 'Maria da Silva',
      email: null,
    });
    await directory.remember(live(tenantA), {
      taxId: CPF,
      name: 'Maria',
      email: 'maria@x.test',
    });
    expect((await directory.find(live(tenantA), CPF))?.name).toBe(
      'Maria da Silva',
    );
  });

  it('never mixes workspaces or environments', async () => {
    expect(await directory.find(live(tenantB), CNPJ)).toBeNull();
    expect(
      await directory.find({ tenantId: tenantA, environment: 'test' }, CNPJ),
    ).toBeNull();
    const other = await directory.list(
      live(tenantB),
      {},
      { limit: 50, offset: 0 },
    );
    expect(other.total).toBe(0);
    // A write scoped to another workspace does not reach the row.
    expect(await directory.remove(live(tenantB), CNPJ)).toBe(false);
    expect(
      await directory.update(live(tenantB), CNPJ, { name: 'Invasor' }),
    ).toBeNull();
    expect((await directory.find(live(tenantA), CNPJ))?.name).toBe('Acme Ltda');
  });

  it('searches by part of the name or the start of the document, most recent first', async () => {
    await directory.remember(live(tenantA), {
      taxId: CPF,
      name: 'Maria da Silva',
    });
    const byName = await directory.list(
      live(tenantA),
      { search: 'silva' },
      { limit: 50, offset: 0 },
    );
    expect(byName.items.map((c) => c.taxId)).toEqual([CPF]);
    const byDocument = await directory.list(
      live(tenantA),
      { search: '112.223' },
      { limit: 50, offset: 0 },
    );
    expect(byDocument.items.map((c) => c.taxId)).toEqual([CNPJ]);
    const all = await directory.list(
      live(tenantA),
      {},
      { limit: 1, offset: 0 },
    );
    expect(all.total).toBe(2);
    expect(all.items.map((c) => c.taxId)).toEqual([CPF]);
    // A literal % is not a wildcard.
    const literal = await directory.list(
      live(tenantA),
      { search: '%' },
      { limit: 50, offset: 0 },
    );
    expect(literal.total).toBe(0);
  });

  it('updates only what is sent and removes the customer', async () => {
    const updated = await directory.update(live(tenantA), CPF, {
      email: 'maria@exemplo.test',
    });
    expect(updated).toMatchObject({
      name: 'Maria da Silva',
      email: 'maria@exemplo.test',
    });
    expect(
      (await directory.update(live(tenantA), CPF, { email: null }))?.email,
    ).toBeNull();
    expect(await directory.remove(live(tenantA), CPF)).toBe(true);
    expect(await directory.find(live(tenantA), CPF)).toBeNull();
    expect(await directory.remove(live(tenantA), CPF)).toBe(false);
  });

  it('keeps the NF-e recipient data: fills only what is empty and an edit changes it', async () => {
    const address = {
      street: 'Av. Paulista',
      number: '1000',
      complement: null,
      district: 'Bela Vista',
      zip: '01310100',
      cityCode: '3550308',
      city: 'São Paulo',
      state: 'SP',
    };
    const scope = live(tenantA);
    await directory.remember(scope, {
      taxId: CNPJ,
      name: 'Acme Ltda',
      address,
      indIeDest: 1,
      stateRegistration: '111222333444',
    });
    expect(await directory.find(scope, CNPJ)).toMatchObject({
      address,
      indIeDest: 1,
      stateRegistration: '111222333444',
    });
    // An automatic save never replaces what is there.
    await directory.remember(scope, {
      taxId: CNPJ,
      name: 'Acme Ltda',
      address: { ...address, street: 'Outra rua' },
      indIeDest: 9,
      stateRegistration: '999',
    });
    expect(await directory.find(scope, CNPJ)).toMatchObject({
      address,
      indIeDest: 1,
      stateRegistration: '111222333444',
    });
    // An explicit edit does, and null removes.
    const edited = await directory.update(scope, CNPJ, {
      address: { ...address, number: '2000' },
      indIeDest: 2,
      stateRegistration: null,
    });
    expect(edited).toMatchObject({
      address: { ...address, number: '2000' },
      indIeDest: 2,
      stateRegistration: null,
    });
    expect(
      (await directory.update(scope, CNPJ, { address: null }))?.address,
    ).toBeNull();
    // The other workspace sees none of it.
    expect(await directory.find(live(tenantB), CNPJ)).toBeNull();
  });

  it('removes the customers together with the workspace', async () => {
    const tenant = randomUUID();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1)`, [
      tenant,
    ]);
    await directory.remember(live(tenant), { taxId: CNPJ, name: 'Acme Ltda' });
    await admin.query(`DELETE FROM "${schema}".tenants WHERE id = $1`, [
      tenant,
    ]);
    const [{ count }]: Array<{ count: string }> = await admin.query(
      `SELECT count(*) FROM "${schema}".customers WHERE tenant_id = $1`,
      [tenant],
    );
    expect(Number(count)).toBe(0);
  });
});
