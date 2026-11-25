import 'reflect-metadata';
import { createCompanyNumberingCheckHandler } from './company-numbering-check.tool';

const ID = '4f6e2b0a-8a52-4d0e-9a3e-1c2b3d4e5f60';
const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;
const company = {
  id: ID,
  toSnapshot: () => ({
    id: ID,
    legalName: 'Corvo',
    taxId: '11222333000181',
    municipalityCode: '3550308',
    status: 'ready',
  }),
};
const companies = {
  findById: jest.fn().mockResolvedValue(company),
  findByTaxId: jest.fn().mockResolvedValue(company),
};

describe('company_numbering_check tool', () => {
  it('reports the numbers used at the government and the suggestion', async () => {
    const numbering = {
      check: jest.fn().mockResolvedValue({
        series: '1',
        nextNumber: 1,
        usedNumbers: [1, 2, 3],
        suggestedNext: 4,
        moreMayBeUsed: false,
      }),
    };
    const handler = createCompanyNumberingCheckHandler(companies, numbering);
    const result = await handler({ company_id: ID }, ctx);
    expect(numbering.check).toHaveBeenCalledWith(
      ID,
      'tenant-1',
      expect.anything(),
    );
    expect(result).toMatchObject({
      status: 'numbers_already_used',
      used_numbers: [1, 2, 3],
      suggested_next: 4,
    });
    expect(result.message).toContain('sai com o número 4');
  });

  it('says ok when the next number is free, finding the company by CNPJ', async () => {
    const numbering = {
      check: jest.fn().mockResolvedValue({
        series: '1',
        nextNumber: 8,
        usedNumbers: [],
        suggestedNext: 8,
        moreMayBeUsed: false,
      }),
    };
    const handler = createCompanyNumberingCheckHandler(companies, numbering);
    const result = await handler({ tax_id: '11222333000181' }, ctx);
    expect(result).toMatchObject({ status: 'ok', suggested_next: 8 });
  });

  it('needs a company', async () => {
    const handler = createCompanyNumberingCheckHandler(companies, {
      check: jest.fn(),
    });
    await expect(handler({}, ctx)).rejects.toThrow('company_id or tax_id');
  });
});
