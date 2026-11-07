import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { DataSource } from 'typeorm';
import { ImportEmitService } from '@/modules/import/application/import-emit.service';
import { ImportIntakeService } from '@/modules/import/application/import-intake.service';
import { ImportReaderService } from '@/modules/import/application/import-reader.service';
import { ImportReviewService } from '@/modules/import/application/import-review.service';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import { ImportFileStorage } from '@/modules/import/infra/import-file-storage';
import {
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

const TAX_A = '11222333000181';
const TAX_B = '45723174000110';
const CUSTOMER = '529.982.247-25';

/** The real database, batch emission and services; only S3 and the queues are replaced. */
describe('spreadsheet import (e2e)', () => {
  let ctx: E2eTestApp;
  let dataSource: DataSource;
  let tenantId: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const files = new Map<string, Buffer>();
  const jobs: Array<{ queue: string; name: string }> = [];
  const fakeStorage = {
    save: (t: string, e: string, id: string, bytes: Buffer) =>
      Promise.resolve(void files.set(`${t}/${e}/${id}`, bytes)),
    read: (t: string, e: string, id: string) =>
      Promise.resolve(files.get(`${t}/${e}/${id}`) as Buffer),
    remove: (t: string, e: string, id: string) =>
      Promise.resolve(void files.delete(`${t}/${e}/${id}`)),
  };
  const queueFor = (queue: string) => ({
    add: (name: string) => Promise.resolve(void jobs.push({ queue, name })),
  });

  const csv = (lines: string[]) =>
    Buffer.from(
      [
        'cnpj_prestador;tomador_documento;tomador_nome;descricao;valor;data_competencia',
        ...lines,
      ].join('\n'),
    );
  const start = (bytes: Buffer, companyId?: string) =>
    ctx.moduleFixture.get(ImportIntakeService).start({
      tenantId,
      environment: 'test',
      userId: 'u1',
      fileName: 'notas.csv',
      bytes,
      companyId,
    });
  const ref = (importId: string) => ({
    tenantId,
    environment: 'test' as const,
    importId,
  });
  const invoices = () =>
    dataSource.getRepository(InvoiceOrmEntity).count({ where: { tenantId } });

  beforeAll(async () => {
    ctx = await createSeededE2eApp((b) =>
      b
        .overrideProvider(ImportFileStorage)
        .useValue(fakeStorage)
        .overrideProvider(getQueueToken('import-read'))
        .useValue(queueFor('import-read'))
        .overrideProvider(getQueueToken('import-emit'))
        .useValue(queueFor('import-emit')),
    );
    dataSource = ctx.dataSource;
    tenantId = ctx.tenantId;
    for (const taxId of [TAX_A, TAX_B])
      await dataSource.query(
        `INSERT INTO "${schema}"."nfse_companies" (id, tenant_id, legal_name, tax_id, municipality_code, municipal_reg, environment, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '3550308', '12345', 'test', 'ready', NOW(), NOW())`,
        [randomUUID(), tenantId, `Empresa ${taxId}`, taxId],
      );
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  it('reads a spreadsheet, lets the user fix a row, emits once, and counts the result', async () => {
    const review = ctx.moduleFixture.get(ImportReviewService);
    const started = await start(
      csv([
        `${TAX_A};${CUSTOMER};Ana;Consultoria;1.500,00;07/11/2026`,
        `${TAX_B};${CUSTOMER};Bruno;Suporte;200,50;2026-11-07`,
        `${TAX_A};${CUSTOMER};Caio;Ruim;abc;07/11/2026`,
      ]),
    );
    expect(started).toMatchObject({ status: 'processing', duplicateOf: null });
    expect(jobs).toEqual([{ queue: 'import-read', name: 'read' }]);

    await ctx.moduleFixture.get(ImportReaderService).read(ref(started.id));
    expect(files.size).toBe(0); // the file is gone after reading
    let view = await review.get(tenantId, 'test', started.id);
    expect(view).toMatchObject({
      status: 'ready',
      counters: { total: 3, valid: 2, invalid: 1 },
    });

    const page = await review.listRows(tenantId, 'test', started.id, {
      limit: 2,
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('3');

    const fixed = await review.updateRow(tenantId, 'test', started.id, 4, {
      amount: 99.9,
    });
    expect(fixed.status).toBe('valid');

    const emitter = ctx.moduleFixture.get(ImportEmitService);
    await emitter.emit(tenantId, 'test', started.id);
    await emitter.emit(tenantId, 'test', started.id); // double click
    expect(jobs.filter((j) => j.queue === 'import-emit')).toHaveLength(1);

    await emitter.run(ref(started.id));
    expect(await invoices()).toBe(3);
    await emitter.run(ref(started.id)); // a retried job issues nothing twice
    expect(await invoices()).toBe(3);

    view = await review.get(tenantId, 'test', started.id);
    expect(view.counters).toMatchObject({ total: 3, accepted: 3, invalid: 0 });
    expect(view.status).toBe('emitting'); // invoices are still queued at the city: not done yet
  });

  it('flags a CNPJ that differs from the chosen company and a missing company', async () => {
    const [{ id: companyId }] = await dataSource.query(
      `SELECT id FROM "${schema}"."nfse_companies" WHERE tenant_id = $1 AND tax_id = $2`,
      [tenantId, TAX_A],
    );
    const started = await start(
      csv([
        `${TAX_B};${CUSTOMER};Ana;Serviço;10,00;07/11/2026`,
        `;${CUSTOMER};Bia;Serviço;10,00;07/11/2026`,
      ]),
      companyId,
    );
    await ctx.moduleFixture.get(ImportReaderService).read(ref(started.id));
    const rows = await ctx.moduleFixture
      .get(ImportReviewService)
      .listRows(tenantId, 'test', started.id, { limit: 10 });
    expect(rows.items.map((r) => [r.status, r.errorCode])).toEqual([
      ['invalid', 'ERROR_IMPORT_COMPANY_MISMATCH'],
      ['valid', null],
    ]);
  });

  it('warns when the same file is sent again, without blocking', async () => {
    const bytes = csv([`${TAX_A};${CUSTOMER};Ana;Serviço;10,00;07/11/2026`]);
    const first = await start(bytes);
    const second = await start(bytes);
    expect(second.duplicateOf).toBe(first.id);
  });
});
