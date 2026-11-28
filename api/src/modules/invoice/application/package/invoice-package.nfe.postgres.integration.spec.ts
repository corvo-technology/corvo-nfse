import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { buildNfeSummaryCsv } from '@/modules/nfe/application/nfe-package-csv';
import { NfePackageContributor } from '@/modules/nfe/application/nfe-package.contributor';
import { TypeormNfePackageQuery } from '@/modules/nfe/infra/typeorm-nfe-package.query';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';
import { InvoiceOrmEntity } from '../../infra/invoice.orm-entity';
import { TypeOrmInvoicePackageRepository } from '../../infra/typeorm-invoice-package.repository';
import { InvoicePackageService } from './invoice-package.service';
import { PackageContributorRegistry } from './package-contributor.registry';
import type { PackageScope } from './package-link.service';

/** The names inside a ZIP, read from its local file headers (test only). */
async function namesOf(stream: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const zip = Buffer.concat(chunks);
  const names: string[] = [];
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

describePostgres('month package with NF-e on PostgreSQL', () => {
  let h: PostgresHarness;
  let s: NfeStack;
  let withNfe: InvoicePackageService;
  let withoutNfe: InvoicePackageService;
  const month = DateTime.now().setZone('America/Sao_Paulo').toFormat('yyyy-MM');
  const scope = (): PackageScope => ({
    tenantId: h.tenantId,
    companyId: h.companyId,
    environment: 'test',
    month,
  });

  beforeAll(async () => {
    h = await createPostgresHarness('nfepack');
    s = createNfeStack(h);
    const invoices = new TypeOrmInvoicePackageRepository(h.helper);
    const companies = {
      findByIdAndTenantId: () =>
        Promise.resolve({
          taxId: '11222333000181',
          legalName: 'Empresa Teste LTDA',
          tradeName: 'Empresa Teste',
        }),
    } as never;
    const registry = new PackageContributorRegistry();
    new NfePackageContributor(
      registry,
      new TypeormNfePackageQuery(h.helper),
      s.events,
      s.storage,
    ).onModuleInit();
    withNfe = new InvoicePackageService(
      invoices,
      s.storage,
      companies,
      registry,
    );
    // Same service as before this PR: no registry at all.
    withoutNfe = new InvoicePackageService(invoices, s.storage, companies);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  /** An NF-e authorized and with its documents stored, as the worker leaves it. */
  const readyNfe = async () => {
    const id = await s.issue('FAKE-100');
    await s.dispatch('nfe.prepare_documents', id);
    return id;
  };

  const open = async (
    service: InvoicePackageService,
    include = ['xml', 'pdf'],
  ) => {
    const { stream, count } = await service.open(
      scope(),
      include as ['xml', 'pdf'],
    );
    return { names: (await namesOf(stream)).sort(), count };
  };

  /** An NFS-e with its two files in the storage. */
  const nfseInvoice = async () => {
    const id = randomUUID();
    s.objects.set(`${h.tenantId}/test/invoices/${id}/invoice.xml`, '<NFSe/>');
    s.objects.set(`${h.tenantId}/test/invoices/${id}/invoice.pdf`, 'pdf');
    await h.admin.getRepository(InvoiceOrmEntity).insert({
      id,
      tenantId: h.tenantId,
      companyId: h.companyId,
      environment: 'test',
      status: 'authorized',
      customerSnapshot: { taxId: '12345678000195', name: 'Acme' },
      serviceSnapshot: { code: '010101', description: 'Serviço' },
      taxSnapshot: {},
      amount: 100,
      competenceDate: `${month}-10`,
      authorizedAt: new Date(),
      documentsReadyAt: new Date(),
      nfseNumber: 4242,
    });
  };

  it('a month with only NFS-e gives the same ZIP with or without the NF-e module', async () => {
    await nfseInvoice();
    const before = await open(withoutNfe);
    const after = await open(withNfe);
    expect(after.names).toEqual(before.names);
    expect(after.names).toContain('resumo.csv');
    expect(after.names.some((n) => n.startsWith('nfe'))).toBe(false);
    expect(after.count).toBe(1);
  });

  it('with two NF-e it adds a nfe/ folder with 4 files and a 3-line nfe-resumo.csv', async () => {
    await readyNfe();
    await readyNfe();
    const { names, count } = await open(withNfe);
    const nfeFiles = names.filter((n) => n.startsWith('nfe/'));
    expect(nfeFiles).toHaveLength(4);
    expect(nfeFiles.filter((n) => n.endsWith('/nfe-proc.xml'))).toHaveLength(2);
    expect(nfeFiles.filter((n) => n.endsWith('/danfe.pdf'))).toHaveLength(2);
    expect(names).toContain('nfe-resumo.csv');
    expect(names).toContain('resumo.csv');
    // The NFS-e files are still there.
    expect(names.filter((n) => n.startsWith('xml/'))).toHaveLength(1);
    expect(count).toBe(3);

    const csv = new TypeormNfePackageQuery(h.helper);
    const rows = await csv.list(scope(), 10);
    expect(rows).toHaveLength(2);
  });

  it('the CSV lists number, series, key, status, date and value', async () => {
    const rows = await new TypeormNfePackageQuery(h.helper).list(scope(), 10);
    const lines = buildNfeSummaryCsv(rows)
      .replace('﻿', '')
      .split('\r\n')
      .filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('numero;serie;chave;status;data;valor;modelo');
    expect(lines[1]).toMatch(/^\d+;1;\d{44};autorizada;\d{2}\/\d{2}\/\d{4};/);
  });

  it('include=xml leaves the DANFE out', async () => {
    const { names } = await open(withNfe, ['xml']);
    expect(names.some((n) => n.endsWith('/danfe.pdf'))).toBe(false);
    expect(names.filter((n) => n.endsWith('/nfe-proc.xml'))).toHaveLength(2);
  });

  it('a cancelled NF-e is listed as cancelada and brings its event XML', async () => {
    const id = await readyNfe();
    await s.cancelService.cancel(
      id,
      h.tenantId,
      'test',
      'Cancelamento por erro na digitação do pedido',
    );
    await s.dispatch('nfe.cancel', id);
    await s.dispatch('nfe.prepare_documents', id);
    const { names } = await open(withNfe);
    expect(
      names.filter((n) => n.includes('/events/110111-1.xml')),
    ).toHaveLength(1);
    const rows = await new TypeormNfePackageQuery(h.helper).list(scope(), 10);
    expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(1);
  });

  it('the summary counts the NF-e and sums only the authorized ones', async () => {
    const before = await withoutNfe.summary(scope());
    const after = await withNfe.summary(scope());
    expect(after.count).toBe(before.count + 3);
    // 2 authorized NF-e of R$ 20,00 each (the cancelled one is not summed).
    expect(Number(after.total) - Number(before.total)).toBeCloseTo(40, 2);
  });

  it('is not empty when the month has only NF-e', async () => {
    await h.admin.query(`DELETE FROM "${h.schema}".nfse_invoices`);
    const { names } = await open(withNfe);
    expect(names.filter((n) => n.startsWith('nfe/')).length).toBeGreaterThan(0);
    await expect(open(withoutNfe)).rejects.toThrow(
      'No authorized or cancelled',
    );
  });

  it('a NFC-e of the month comes in an nfce/ folder with its XML and DANFCE', async () => {
    const id = await s.issueNfce('FAKE-100');
    await s.dispatch('nfe.prepare_documents', id);
    const { names } = await open(withNfe);
    const nfceFiles = names.filter((n) => n.startsWith('nfce/'));
    expect(nfceFiles).toHaveLength(2);
    expect(nfceFiles.some((n) => n.endsWith('/nfe-proc.xml'))).toBe(true);
    expect(nfceFiles.some((n) => n.endsWith('/danfce.pdf'))).toBe(true);
    const rows = await new TypeormNfePackageQuery(h.helper).list(scope(), 50);
    expect(rows.filter((r) => r.model === 65)).toHaveLength(1);
  });
});
