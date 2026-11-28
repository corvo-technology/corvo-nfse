import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmServiceFavoriteRepository } from './typeorm-service-favorite.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `sfav_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const companyA = randomUUID(),
  companyB = randomUUID(),
  companyC = randomUUID();

const input = {
  label: 'Mensalidade',
  description: 'Consultoria mensal',
  serviceCode: '010101',
  amountCents: 15000,
  municipalityCode: '3550308',
};

describePostgres('TypeOrmServiceFavoriteRepository (RLS integration)', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repository: TypeOrmServiceFavoriteRepository;
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
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test'),($3,$4,'Other','11222333000182','test')`,
      [companyA, tenantA, companyB, tenantB],
    );
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
    repository = new TypeOrmServiceFavoriteRepository(runtime);
  }, 60000);

  afterEach(async () => {
    await admin.query(`DELETE FROM ${table('service_favorites')}`);
    await admin.query(`DELETE FROM ${table('nfse_companies')} WHERE id = $1`, [
      companyC,
    ]);
  });

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it('creates, lists and deletes a favorite', async () => {
    const created = await repository.create(companyA, tenantA, input);
    expect(created).toMatchObject({
      ...input,
      tenantId: tenantA,
      companyId: companyA,
    });
    await expect(repository.list(companyA, tenantA)).resolves.toEqual([
      created,
    ]);
    await expect(
      repository.delete(created.id, companyA, tenantA),
    ).resolves.toBe(true);
    await expect(repository.list(companyA, tenantA)).resolves.toEqual([]);
  });

  it('never shows or removes another tenant favorite', async () => {
    const mine = await repository.create(companyA, tenantA, input);
    await repository.create(companyB, tenantB, { ...input, label: 'Outra' });

    expect(await repository.list(companyA, tenantA)).toHaveLength(1);
    // The same company id read as another tenant sees nothing (RLS plus predicate).
    await expect(repository.list(companyA, tenantB)).resolves.toEqual([]);
    await expect(repository.delete(mine.id, companyA, tenantB)).resolves.toBe(
      false,
    );
    await expect(repository.list(companyA, tenantA)).resolves.toEqual([mine]);
  });

  const product = {
    kind: 'product' as const,
    label: 'Camiseta algodão',
    description: 'Camiseta algodão',
    code: 'CAM-1',
    ncm: '61091000',
    cfop: '5102',
    unit: 'UN',
    unitPrice: 49.9,
  };

  it('keeps services and products apart, and the same product description updates it', async () => {
    const service = await repository.create(companyA, tenantA, input);
    const first = await repository.create(companyA, tenantA, product);
    expect(first).toMatchObject({
      kind: 'product',
      serviceCode: null,
      ncm: '61091000',
      unitPrice: 49.9,
      code: 'CAM-1',
      unit: 'UN',
    });
    const again = await repository.create(companyA, tenantA, {
      ...product,
      description: 'CAMISETA ALGODÃO',
      unitPrice: 59.9,
      csosn: '102',
    });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ unitPrice: 59.9, csosn: '102' });
    await expect(
      repository.list(companyA, tenantA, 'product'),
    ).resolves.toEqual([again]);
    await expect(repository.list(companyA, tenantA)).resolves.toEqual([
      service,
    ]);
    // The same description in another company is another product.
    await admin.query(
      `INSERT INTO ${table('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Third','11222333000183','test')`,
      [companyC, tenantA],
    );
    const other = await repository.create(companyC, tenantA, product);
    expect(other.id).not.toBe(first.id);
    await expect(repository.delete(first.id, companyA, tenantA)).resolves.toBe(
      true,
    );
  });

  it('never shows or removes a product of another tenant', async () => {
    const mine = await repository.create(companyA, tenantA, product);
    await repository.create(companyB, tenantB, product);
    await expect(
      repository.list(companyA, tenantB, 'product'),
    ).resolves.toEqual([]);
    await expect(repository.delete(mine.id, companyA, tenantB)).resolves.toBe(
      false,
    );
    await expect(
      repository.list(companyA, tenantA, 'product'),
    ).resolves.toEqual([mine]);
  });

  it('rejects raw SQL that reads or writes across tenants through the runtime role', async () => {
    await repository.create(companyB, tenantB, input);
    await runWithTenant(tenantA, async () => {
      const rows: unknown[] = await runtime.query(
        `SELECT id FROM ${table('service_favorites')}`,
      );
      expect(rows).toEqual([]);
      await expect(
        runtime.query(
          `INSERT INTO ${table('service_favorites')} (tenant_id,company_id,label,description,service_code) VALUES ($1,$2,'x','x','010101')`,
          [tenantB, companyB],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    });
  });
});
