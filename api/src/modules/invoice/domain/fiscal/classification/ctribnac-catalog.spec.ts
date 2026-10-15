import { JsonFiscalCatalog } from './ctribnac-catalog';

const file = {
  kind: 'ctribnac' as const,
  version: '2026-10-r1',
  sourceUrl: 'https://example.invalid/test',
  publishedAt: '2026-10-01',
  checksum: 'x',
  entries: [
    { code: '060101', description: 'Cabeleireiros' },
    { code: '010601', description: 'Assessoria e consultoria em informática' },
  ],
};

describe('JsonFiscalCatalog', () => {
  const catalog = new JsonFiscalCatalog(file);
  it('finds listed service codes with the catalog version', () => {
    expect(catalog.lookupServiceCode('060101')).toEqual({
      version: '2026-10-r1',
      found: true,
    });
  });
  it('reports unknown codes', () =>
    expect(catalog.lookupServiceCode('999999').found).toBe(false));
  it('rejects malformed codes', () =>
    expect(catalog.lookupServiceCode('0601').found).toBe(false));
  it('does not validate NBS/CST/cClassTrib while those catalogs are not loaded', async () => {
    await expect(
      catalog.validateClassification(
        {
          serviceCode: '060101',
          nbsCode: '123456789',
          cst: null,
          classCode: null,
          operationIndicator: null,
        },
        '2026-10-13',
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: expect.stringContaining('NBS/CST/cClassTrib'),
      transient: false,
    });
  });
  it('refuses a malformed file', () => {
    expect(
      () =>
        new JsonFiscalCatalog({
          ...file,
          entries: [{ code: '12', description: 'x' }],
        }),
    ).toThrow('Invalid cTribNac code');
    expect(
      () =>
        new JsonFiscalCatalog({
          ...file,
          entries: [file.entries[0], file.entries[0]],
        }),
    ).toThrow('Duplicate cTribNac code');
  });
});
