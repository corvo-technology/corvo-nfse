import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { IDocumentStorage } from '@/infra/storage/domain/document-storage';
import { TypeOrmCompanyRepository } from '@/modules/company/infra/typeorm-company.repository';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { InvoiceOrmEntity } from '../../infra/invoice.orm-entity';
import { TypeOrmAccountantPackageRepository } from '../../infra/typeorm-accountant-package.repository';
import { TypeOrmInvoicePackageRepository } from '../../infra/typeorm-invoice-package.repository';
import {
  InvoicePackageService,
  PACKAGE_MAX_INVOICES,
} from './invoice-package.service';
import type { PackageScope } from './package-link.service';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Package integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `Package_${randomUUID().replaceAll('-', '')}`;

/** Reads a ZIP into {name: content} using the central directory (yauzl-free, test only). */
async function unzip(stream: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const zip = Buffer.concat(chunks);
  const names: string[] = [];
  // Local file headers: signature 0x04034b50, name length at +26, extra at +28.
  for (let at = 0; at < zip.length - 4;) {
    if (zip.readUInt32LE(at) !== 0x04034b50) {
      at++;
      continue;
    }
    const nameLength = zip.readUInt16LE(at + 26);
    names.push(zip.subarray(at + 30, at + 30 + nameLength).toString('utf8'));
    at += 30 + nameLength;
  }
  return names;
}

describePostgres('month package against PostgreSQL', () => {
  let db: DataSource;
  let service: InvoicePackageService;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyA2 = randomUUID();
  const companyB = randomUUID();
  const companyTest = randomUUID();
  const reads: string[] = [];
  const delayMs = Number(process.env.PACKAGE_BENCH_LATENCY_MS ?? 0);
  const storage = {
    getXml: async (tenantId: string, invoiceId: string) => {
      reads.push(`xml:${tenantId}:${invoiceId}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return `<NFSe>${'x'.repeat(8000)}</NFSe>`;
    },
    getPdf: async (tenantId: string, invoiceId: string) => {
      reads.push(`pdf:${tenantId}:${invoiceId}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (invoiceId === brokenId) throw new Error('NoSuchKey');
      return randomBytes(60_000);
    },
  } as unknown as IDocumentStorage;
  let brokenId = '';

  const scope = (over: Partial<PackageScope> = {}): PackageScope => ({
    tenantId: tenantA,
    companyId: companyA,
    environment: 'live',
    month: '2026-11',
    ...over,
  });

  async function invoice(
    over: Partial<InvoiceOrmEntity> & {
      tenantId: string;
      companyId: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await db.getRepository(InvoiceOrmEntity).insert({
      id,
      environment: 'live',
      status: 'authorized',
      customerSnapshot: { taxId: '12345678000195', name: 'Acme' },
      serviceSnapshot: { code: '010101', description: 'Serviço' },
      taxSnapshot: {},
      amount: 100,
      competenceDate: '2026-11-10',
      authorizedAt: new Date('2026-11-10T12:00:00Z'),
      documentsReadyAt: new Date('2026-11-10T12:01:00Z'),
      nfseNumber: Math.floor(Math.random() * 1e9),
      ...over,
    });
    return id;
  }

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({
        url: url!,
        schema,
        ssl: false,
        logging: false,
      }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    installRlsConnectionScope(db);
    await db.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    for (const [id, tenant, taxId, environment] of [
      [companyA, tenantA, '11222333000181', 'live'],
      [companyA2, tenantA, '22333444000172', 'live'],
      [companyB, tenantB, '33444555000163', 'live'],
      [companyTest, tenantA, '11222333000181', 'test'],
    ])
      await db.query(
        `INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment) VALUES ($1,$2,'Fixture',$3,$4)`,
        [id, tenant, taxId, environment],
      );
    const helper = new TypeOrmRepositoryHelper(
      db,
      new TypeOrmTransactionContext(),
    );
    service = new InvoicePackageService(
      new TypeOrmInvoicePackageRepository(helper),
      storage,
      new TypeOrmCompanyRepository(db.getRepository(CompanyOrmEntity)),
    );
  }, 180000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('claims a month once and never touches another tenant company', async () => {
    const repo = new TypeOrmAccountantPackageRepository(
      new TypeOrmRepositoryHelper(db, new TypeOrmTransactionContext()),
    );
    await repo.setEmail(tenantA, companyA, 'contador@example.com');
    expect(await repo.claimMonth(tenantA, companyA, '2026-10', false)).toBe(
      true,
    );
    expect(await repo.claimMonth(tenantA, companyA, '2026-10', false)).toBe(
      false,
    );
    expect(await repo.claimMonth(tenantA, companyA, '2026-10', true)).toBe(
      true,
    );
    // companyB belongs to tenantB: tenantA cannot read or change it.
    expect(await repo.find(tenantA, companyB, 'live')).toBeNull();
    await repo.setEmail(tenantA, companyB, 'x@example.com');
    expect(await repo.claimMonth(tenantA, companyB, '2026-10', false)).toBe(
      false,
    );
    const own = await repo.find(tenantB, companyB, 'live');
    expect(own?.accountantEmail).toBeNull();
    expect((await repo.listEnabled(tenantA)).map((c) => c.id)).toEqual([
      companyA,
    ]);
    expect(await repo.listEnabled(tenantB)).toEqual([]);
  });

  it('has no schema drift on the accountant columns', async () => {
    const diff = await db.driver.createSchemaBuilder().log();
    expect(
      diff.upQueries.filter((q) => q.query.includes('accountant')),
    ).toEqual([]);
  });

  it('packages only authorized and cancelled notes of the month, company and tenant', async () => {
    reads.length = 0;
    const authorized = await invoice({
      tenantId: tenantA,
      companyId: companyA,
    });
    const cancelled = await invoice({
      tenantId: tenantA,
      companyId: companyA,
      status: 'cancelled',
      nfseNumber: 7,
    });
    const pending = await invoice({
      tenantId: tenantA,
      companyId: companyA,
      documentsReadyAt: undefined,
    });
    // Everything below must stay out.
    await invoice({
      tenantId: tenantA,
      companyId: companyA,
      status: 'rejected',
    });
    await invoice({ tenantId: tenantA, companyId: companyA, status: 'queued' });
    await invoice({
      tenantId: tenantA,
      companyId: companyA,
      competenceDate: '2026-10-31',
    });
    await invoice({
      tenantId: tenantA,
      companyId: companyA,
      competenceDate: '2026-12-01',
    });
    await invoice({ tenantId: tenantA, companyId: companyA2 });
    await invoice({
      tenantId: tenantA,
      companyId: companyTest,
      environment: 'test',
    });
    const foreign = await invoice({ tenantId: tenantB, companyId: companyB });

    const summary = await runWithTenant(tenantA, () =>
      service.summary(scope()),
    );
    expect(summary.count).toBe(3);
    expect(summary.total).toBe('200.00');

    const { stream, fileName, count } = await runWithTenant(tenantA, () =>
      service.open(scope(), ['xml', 'pdf']),
    );
    expect(count).toBe(3);
    expect(fileName).toBe('nfse-2026-11-11222333000181.zip');
    const names = await unzip(stream);
    expect(names.at(-1)).toBe('resumo.csv');
    expect(names.filter((n) => n.startsWith('xml/'))).toHaveLength(2);
    expect(names).toContain('xml/cancelada-000007.xml');
    expect(names).toContain('pdf/cancelada-000007.pdf');
    expect(reads.join()).toContain(authorized);
    expect(reads.join()).toContain(cancelled);
    expect(reads.join()).not.toContain(pending);
    expect(reads.join()).not.toContain(foreign);
    expect(reads.every((r) => r.includes(`:${tenantA}:`))).toBe(true);
  });

  it('never returns another tenant package, even with a foreign company id', async () => {
    await expect(
      runWithTenant(tenantB, () =>
        service.open(scope({ tenantId: tenantB }), ['xml']),
      ),
    ).rejects.toMatchObject({ response: { code: 'COMPANY_NOT_FOUND' } });
  });

  it('answers 404 for an empty month and 422 above the limit', async () => {
    await expect(
      runWithTenant(tenantA, () =>
        service.open(scope({ month: '2030-01' }), ['xml']),
      ),
    ).rejects.toMatchObject({ response: { code: 'PACKAGE_EMPTY' } });
  });

  it('refuses a month above the limit with the count', async () => {
    const company = randomUUID();
    await db.query(
      `INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment) VALUES ($1,$2,'Big','55666777000145','live')`,
      [company, tenantA],
    );
    const rows = Array.from({ length: PACKAGE_MAX_INVOICES + 1 }, (_, i) => ({
      id: randomUUID(),
      tenantId: tenantA,
      companyId: company,
      environment: 'live',
      status: 'authorized',
      customerSnapshot: {},
      serviceSnapshot: {},
      taxSnapshot: {},
      amount: 1,
      competenceDate: '2026-08-10',
      nfseNumber: i + 1,
    }));
    for (let i = 0; i < rows.length; i += 100)
      await db.getRepository(InvoiceOrmEntity).insert(rows.slice(i, i + 100));
    await expect(
      runWithTenant(tenantA, () =>
        service.open(scope({ companyId: company, month: '2026-08' }), ['xml']),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PACKAGE_TOO_LARGE',
        count: PACKAGE_MAX_INVOICES + 1,
        limit: PACKAGE_MAX_INVOICES,
      },
    });
  });

  it('keeps a document that cannot be read out of the zip and flags it', async () => {
    brokenId = await invoice({
      tenantId: tenantA,
      companyId: companyA2,
      nfseNumber: 99,
    });
    const { stream } = await runWithTenant(tenantA, () =>
      service.open(scope({ companyId: companyA2 }), ['xml', 'pdf']),
    );
    const names = await unzip(stream);
    expect(names).toContain('xml/000099.xml');
    expect(names).not.toContain('pdf/000099.pdf');
    expect(names.at(-1)).toBe('resumo.csv');
    brokenId = '';
  });

  const bench = Number(process.env.PACKAGE_BENCH_COUNT ?? 0);
  (bench ? it : it.skip)(
    'bench: builds a big month and prints the time',
    async () => {
      const company = randomUUID();
      await db.query(
        `INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment) VALUES ($1,$2,'Bench','44555666000154','live')`,
        [company, tenantA],
      );
      const rows = Array.from({ length: bench }, (_, i) => ({
        id: randomUUID(),
        tenantId: tenantA,
        companyId: company,
        environment: 'live',
        status: 'authorized',
        customerSnapshot: { taxId: '12345678000195', name: `Cliente ${i}` },
        serviceSnapshot: { code: '010101', description: 'Serviço' },
        taxSnapshot: {},
        amount: 100,
        competenceDate: '2026-09-10',
        authorizedAt: new Date('2026-09-10T12:00:00Z'),
        documentsReadyAt: new Date('2026-09-10T12:01:00Z'),
        nfseNumber: 1000 + i,
      }));
      for (let i = 0; i < rows.length; i += 100)
        await db.getRepository(InvoiceOrmEntity).insert(rows.slice(i, i + 100));
      const started = Date.now();
      const { stream } = await runWithTenant(tenantA, () =>
        service.open(scope({ companyId: company, month: '2026-09' }), [
          'xml',
          'pdf',
        ]),
      );
      let bytes = 0;
      for await (const chunk of stream) bytes += (chunk as Buffer).length;
      const seconds = (Date.now() - started) / 1000;
      process.stdout.write(
        `PACKAGE_BENCH notes=${bench} latencyMs=${delayMs} seconds=${seconds.toFixed(2)} zipMB=${(bytes / 1e6).toFixed(1)}\n`,
      );
      expect(PACKAGE_MAX_INVOICES).toBeGreaterThan(0);
    },
    300000,
  );
});
