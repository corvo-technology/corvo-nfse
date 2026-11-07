import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmImportRepository } from './typeorm-import.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `import_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();

import type { ImportRow } from '../domain/import';

describePostgres('import repository with restricted role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmImportRepository;
  const context = new TypeOrmTransactionContext();

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
    repo = new TypeOrmImportRepository(runtime, context);
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  const base = (tenantId: string) => ({
    id: randomUUID(),
    tenantId,
    environment: 'live' as const,
    userId: 'user-1',
    fileName: 'notas.csv',
    fileHash: 'h'.repeat(64),
    companyId: null,
  });
  const row = (
    line: number,
    status: ImportRow['status'],
    invoiceId: string | null = null,
  ): ImportRow => ({
    line,
    data: { amount: line },
    status,
    errorCode: status === 'invalid' ? 'ERROR_VALIDATION' : null,
    errorMessage: null,
    invoiceId,
  });
  const insertInvoice = async (tenantId: string, status: string) => {
    const id = randomUUID();
    await admin.transaction(async (m) => {
      await m.query('SET LOCAL session_replication_role = replica');
      await m.query(
        `INSERT INTO "${schema}".nfse_invoices (id, tenant_id, environment, status, company_id, customer_snapshot, service_snapshot, tax_snapshot, amount, competence_date) VALUES ($1,$2,'live',$3,$4,'{}','{}','{}',1,'2026-11-07')`,
        [id, tenantId, status, randomUUID()],
      );
    });
    return id;
  };

  it('counts rows by outcome, joining the invoice status for authorized and failed', async () => {
    const imp = await repo.create(base(tenantA));
    const auth = await insertInvoice(tenantA, 'authorized');
    const rej = await insertInvoice(tenantA, 'rejected');
    const proc = await insertInvoice(tenantA, 'processing');
    await repo.insertRows(tenantA, imp.id, [
      row(1, 'valid'),
      row(2, 'invalid'),
      row(3, 'accepted', auth),
      row(4, 'accepted', rej),
      row(5, 'accepted', proc),
      row(6, 'rejected'),
      row(7, 'queued'),
    ]);
    expect(await repo.counters(tenantA, 'live', imp.id)).toEqual({
      total: 7,
      valid: 1,
      invalid: 1,
      accepted: 3,
      authorized: 1,
      awaitingCredits: 0,
      validAmount: 1, // the one valid row (line 1) carries amount 1
      awaitingAmount: 0,
      failed: 3, // invalid + rejected row + accepted-then-rejected invoice
      pending: 3, // valid + queued + accepted still processing
    });
  });

  it('sums the amount of the ready rows and of the rows waiting for credits, in reais', async () => {
    const imp = await repo.create(base(tenantA));
    const money = (
      line: number,
      status: ImportRow['status'],
      amount: unknown,
      errorCode: string | null = null,
    ): ImportRow => ({
      line,
      data: { amount },
      status,
      errorCode,
      errorMessage: null,
      invoiceId: null,
    });
    await repo.insertRows(tenantA, imp.id, [
      money(1, 'valid', 1500.5),
      money(2, 'valid', 99.9),
      money(3, 'invalid', 'abc', 'ERROR_VALIDATION'),
      money(4, 'rejected', 200, 'ERROR_MONTHLY_LIMIT_EXCEEDED'),
      money(5, 'rejected', 7, 'ERROR_VALIDATION'),
    ]);
    expect(await repo.counters(tenantA, 'live', imp.id)).toMatchObject({
      validAmount: 1600.4,
      awaitingAmount: 200,
    });
    const empty = await repo.create(base(tenantA));
    expect(await repo.counters(tenantA, 'live', empty.id)).toMatchObject({
      validAmount: 0,
      awaitingAmount: 0,
    });
  });

  it('remembers how many rows the file has while it is still being read', async () => {
    const imp = await repo.create(base(tenantA));
    expect(
      (await repo.findById(tenantA, 'live', imp.id))?.rowsExpected,
    ).toBeNull();
    await repo.updateStatus(tenantA, imp.id, {
      status: 'processing',
      rowsExpected: 300,
    });
    expect((await repo.findById(tenantA, 'live', imp.id))?.rowsExpected).toBe(
      300,
    );
  });

  it('keeps rows waiting for credits apart from real errors', async () => {
    const imp = await repo.create(base(tenantA));
    const limited = (line: number) => ({
      ...row(line, 'rejected'),
      errorCode: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
    });
    await repo.insertRows(tenantA, imp.id, [
      row(1, 'invalid'),
      limited(2),
      limited(3),
      { ...row(4, 'rejected'), errorCode: 'ERROR_VALIDATION' },
    ]);
    expect(await repo.counters(tenantA, 'live', imp.id)).toMatchObject({
      total: 4,
      awaitingCredits: 2,
      failed: 2,
      pending: 0,
    });
  });

  it('counts many imports at once and lists the newest first, scoped to tenant and environment', async () => {
    const first = await repo.create(base(tenantA));
    const second = await repo.create(base(tenantA));
    await repo.create({ ...base(tenantA), environment: 'test' });
    await repo.create(base(tenantB));
    await repo.insertRows(tenantA, second.id, [
      row(1, 'valid'),
      row(2, 'valid'),
    ]);
    await admin.query(
      `UPDATE "${schema}".imports SET created_at = now() - interval '1 hour' WHERE id = $1`,
      [first.id],
    );
    const recent = await repo.listRecent(tenantA, 'live', 50);
    expect(
      recent
        .map((r) => r.id)
        .filter((id) => id === first.id || id === second.id),
    ).toEqual([second.id, first.id]);
    expect(await repo.listRecent(tenantA, 'live', 2)).toHaveLength(2);
    const counts = await repo.countersMany(tenantA, 'live', [
      first.id,
      second.id,
    ]);
    expect(counts.get(second.id)).toMatchObject({
      total: 2,
      valid: 2,
      pending: 2,
    });
    expect(counts.get(first.id)).toMatchObject({ total: 0 });
    expect(
      (await repo.listRecent(tenantA, 'live', 50)).every(
        (r) => r.environment === 'live' && r.tenantId === tenantA,
      ),
    ).toBe(true);
  });

  it('lists accepted rows whose invoice failed afterwards, with the invoice error, by line', async () => {
    const imp = await repo.create(base(tenantA));
    const bad = await insertInvoice(tenantA, 'rejected');
    const good = await insertInvoice(tenantA, 'authorized');
    await admin.query(
      `UPDATE "${schema}".nfse_invoices SET last_error_code = 'FISCAL_REJECTED', last_error_message = 'CPF do tomador não encontrado' WHERE id = $1`,
      [bad],
    );
    await repo.insertRows(tenantA, imp.id, [
      row(1, 'accepted', good),
      row(2, 'accepted', bad),
      row(3, 'valid'),
    ]);
    const out = await repo.listFailedInvoices(tenantA, 'live', imp.id, {
      limit: 10,
    });
    expect(out.items.map((r) => [r.line, r.errorCode, r.errorMessage])).toEqual(
      [[2, 'FISCAL_REJECTED', 'CPF do tomador não encontrado']],
    );
    expect(out.nextCursor).toBeNull();
  });

  it('pages rows by cursor without repeating or skipping any', async () => {
    const imp = await repo.create(base(tenantA));
    await repo.insertRows(
      tenantA,
      imp.id,
      Array.from({ length: 120 }, (_, i) =>
        row(i + 1, i % 2 ? 'valid' : 'invalid'),
      ),
    );
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.listRows(tenantA, 'live', imp.id, {
        limit: 50,
        cursor,
      });
      seen.push(...page.items.map((r) => r.line));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    const invalid = await repo.listRows(tenantA, 'live', imp.id, {
      limit: 200,
      status: 'invalid',
    });
    expect(invalid.items).toHaveLength(60);
    expect(invalid.nextCursor).toBeNull();
  });

  it('another tenant or environment never sees the import (RLS and scope)', async () => {
    const imp = await repo.create(base(tenantA));
    expect(await repo.findById(tenantB, 'live', imp.id)).toBeNull();
    expect(await repo.findById(tenantA, 'test', imp.id)).toBeNull();
    expect(await repo.findById(tenantA, 'live', imp.id)).toMatchObject({
      id: imp.id,
      status: 'processing',
    });
  });

  it('finds an earlier import by file hash for the same company scope', async () => {
    const imp = await repo.create({
      ...base(tenantA),
      fileHash: 'a'.repeat(64),
    });
    expect(
      (await repo.findByFileHash(tenantA, 'live', null, 'a'.repeat(64)))?.id,
    ).toBe(imp.id);
    expect(
      await repo.findByFileHash(tenantA, 'live', randomUUID(), 'a'.repeat(64)),
    ).toBeNull();
    expect(
      await repo.findByFileHash(tenantB, 'live', null, 'a'.repeat(64)),
    ).toBeNull();
  });

  it('clears the rows of one import only', async () => {
    const a = await repo.create(base(tenantA));
    const b = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, a.id, [row(1, 'valid')]);
    await repo.insertRows(tenantA, b.id, [row(1, 'valid')]);
    await repo.deleteRows(tenantA, a.id);
    expect(
      (await repo.listRows(tenantA, 'live', a.id, { limit: 10 })).items,
    ).toHaveLength(0);
    expect(
      (await repo.listRows(tenantA, 'live', b.id, { limit: 10 })).items,
    ).toHaveLength(1);
  });

  it('finds one row inside its own import, environment and tenant only', async () => {
    const imp = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, imp.id, [row(3, 'valid')]);
    expect(await repo.findRow(tenantA, 'live', imp.id, 3)).toMatchObject({
      line: 3,
    });
    expect(await repo.findRow(tenantA, 'live', imp.id, 4)).toBeNull();
    expect(await repo.findRow(tenantA, 'test', imp.id, 3)).toBeNull();
    expect(await repo.findRow(tenantB, 'live', imp.id, 3)).toBeNull();
  });

  it('claims the emit once: ready or done to emitting, never twice', async () => {
    const imp = await repo.create(base(tenantA));
    expect(await repo.claimEmit(tenantA, imp.id)).toBe(false); // still processing
    await repo.updateStatus(tenantA, imp.id, { status: 'ready' });
    const [first, second] = await Promise.all([
      repo.claimEmit(tenantA, imp.id),
      repo.claimEmit(tenantA, imp.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await repo.findById(tenantA, 'live', imp.id))?.status).toBe(
      'emitting',
    );
    await repo.updateStatus(tenantA, imp.id, { status: 'done' });
    expect(await repo.claimEmit(tenantA, imp.id)).toBe(true);
  });

  it('queues valid rows and plan-limit rejections only, then rejects what is still queued', async () => {
    const imp = await repo.create(base(tenantA));
    const limited = {
      ...row(3, 'rejected'),
      errorCode: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
    };
    const other = { ...row(4, 'rejected'), errorCode: 'ERROR_VALIDATION' };
    await repo.insertRows(tenantA, imp.id, [
      row(1, 'valid'),
      row(2, 'invalid'),
      limited,
      other,
      row(5, 'accepted'),
    ]);
    expect(
      await repo.markRowsQueued(tenantA, imp.id, [
        'ERROR_MONTHLY_LIMIT_EXCEEDED',
      ]),
    ).toBe(2);
    await repo.rejectQueued(tenantA, imp.id, {
      code: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
      message: 'limit',
    });
    const all = await repo.listRows(tenantA, 'live', imp.id, { limit: 10 });
    expect(all.items.map((r) => [r.line, r.status])).toEqual([
      [1, 'rejected'],
      [2, 'invalid'],
      [3, 'rejected'],
      [4, 'rejected'],
      [5, 'accepted'],
    ]);
    expect(all.items[0]).toMatchObject({
      errorCode: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
      errorMessage: 'limit',
    });
    expect(all.items[3]).toMatchObject({ errorCode: 'ERROR_VALIDATION' });
  });

  it('drops only imports older than the given days, rows included', async () => {
    const oldImp = await repo.create(base(tenantA));
    const fresh = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, oldImp.id, [row(1, 'valid')]);
    await admin.query(
      `UPDATE "${schema}".imports SET created_at = now() - interval '40 days' WHERE id = $1`,
      [oldImp.id],
    );
    expect(await repo.deleteOlderThan(30)).toBeGreaterThanOrEqual(1);
    expect(await repo.findById(tenantA, 'live', oldImp.id)).toBeNull();
    expect(await repo.findById(tenantA, 'live', fresh.id)).not.toBeNull();
    const rows = await admin.query(
      `SELECT 1 FROM "${schema}".import_rows WHERE import_id = $1`,
      [oldImp.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('closes as done only while emitting and with nothing queued', async () => {
    const imp = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, imp.id, [row(1, 'queued')]);
    await repo.updateStatus(tenantA, imp.id, { status: 'emitting' });
    expect(await repo.markDone(tenantA, imp.id)).toBe(false); // a row is still queued
    await repo.updateRow(tenantA, imp.id, 1, { status: 'accepted' });
    expect(await repo.markDone(tenantA, imp.id)).toBe(true);
    expect((await repo.findById(tenantA, 'live', imp.id))?.status).toBe('done');
    expect(await repo.markDone(tenantA, imp.id)).toBe(false); // already done
    const other = await repo.create(base(tenantA));
    expect(await repo.markDone(tenantA, other.id)).toBe(false); // processing never closes
  });

  it('edits a row only while it is valid or invalid and the import is ready', async () => {
    const imp = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, imp.id, [
      row(1, 'invalid'),
      row(2, 'queued'),
    ]);
    expect(
      await repo.updateEditableRow(tenantA, imp.id, 1, { status: 'valid' }),
    ).toBe(false); // import still processing
    await repo.updateStatus(tenantA, imp.id, { status: 'ready' });
    expect(
      await repo.updateEditableRow(tenantA, imp.id, 1, {
        status: 'valid',
        errorCode: null,
      }),
    ).toBe(true);
    expect(
      await repo.updateEditableRow(tenantA, imp.id, 2, { status: 'valid' }),
    ).toBe(false); // queued meanwhile
    expect((await repo.findRow(tenantA, 'live', imp.id, 2))?.status).toBe(
      'queued',
    );
  });

  it('updates a row and deletes the import with its rows', async () => {
    const imp = await repo.create(base(tenantA));
    await repo.insertRows(tenantA, imp.id, [row(1, 'invalid')]);
    await repo.updateRow(tenantA, imp.id, 1, {
      status: 'valid',
      errorCode: null,
    });
    expect(
      (await repo.listRows(tenantA, 'live', imp.id, { limit: 10 })).items[0],
    ).toMatchObject({ status: 'valid', errorCode: null });
    await repo.delete(tenantA, imp.id);
    expect(await repo.findById(tenantA, 'live', imp.id)).toBeNull();
  });
});
