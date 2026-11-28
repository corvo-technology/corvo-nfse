import type { PackageNfe } from '../infra/typeorm-nfe-package.query';
import { buildNfeSummaryCsv } from './nfe-package-csv';
import { NfePackageContributor } from './nfe-package.contributor';

const scope = {
  tenantId: 't',
  companyId: 'c',
  environment: 'test' as const,
  month: '2026-11',
};

const row = (overrides: Partial<PackageNfe>): PackageNfe => ({
  id: 'id',
  tenantId: 't',
  environment: 'test',
  model: 55,
  series: 1,
  number: 5,
  accessKey: 'K'.repeat(44),
  status: 'authorized',
  issuedAt: new Date('2026-11-10T15:00:00Z'),
  total: '20.00',
  documentsReady: true,
  ...overrides,
});

function build(rows: PackageNfe[]) {
  const getFile = jest
    .fn()
    .mockImplementation((_ref, name: string) =>
      Promise.resolve(Buffer.from(name)),
    );
  const contributor = new NfePackageContributor(
    { register: jest.fn() } as never,
    { list: jest.fn().mockResolvedValue(rows) } as never,
    { list: jest.fn().mockResolvedValue([]) } as never,
    { getFile } as never,
  );
  return { contributor, getFile };
}

async function filesOf(rows: PackageNfe[], include: ('xml' | 'pdf')[]) {
  const { contributor } = build(rows);
  const { entries } = await contributor.collect(scope, 10);
  return (await Promise.all(entries.map((e) => e.read(include)))).flat();
}

describe('NfePackageContributor with NF-e and NFC-e', () => {
  it('puts the NFC-e in an nfce/ folder with its XML and DANFCE, next to the NF-e', async () => {
    const files = await filesOf(
      [row({ id: 'a' }), row({ id: 'b', model: 65, number: 9 })],
      ['xml', 'pdf'],
    );
    expect(files.map((f) => f.name).sort()).toEqual([
      'nfce/1-000009/danfce.pdf',
      'nfce/1-000009/nfe-proc.xml',
      'nfe/1-000005/danfe.pdf',
      'nfe/1-000005/nfe-proc.xml',
    ]);
  });

  it('xml only leaves the DANFCE out too', async () => {
    const files = await filesOf([row({ model: 65 })], ['xml']);
    expect(files.map((f) => f.name)).toEqual(['nfce/1-000005/nfe-proc.xml']);
  });

  it('one summary lists both models, with the model in the last column', async () => {
    const { contributor } = build([row({}), row({ model: 65, number: 9 })]);
    const { sheet } = await contributor.collect(scope, 10);
    const lines = sheet!.content
      .toString('utf8')
      .replace('﻿', '')
      .split('\r\n')
      .filter(Boolean);
    expect(lines[0]).toBe('numero;serie;chave;status;data;valor;modelo');
    expect(lines[1]).toMatch(/;20,00;55$/);
    expect(lines[2]).toMatch(/^9;1;.*;20,00;65$/);
    expect(buildNfeSummaryCsv([])).toContain('modelo');
  });
});
