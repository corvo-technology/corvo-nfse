import 'reflect-metadata';
import { createCompanyGetHandler } from './company-get.tool';

it('company_get returns the company matched by CNPJ', async () => {
  const company = {
    id: 'company-1',
    toSnapshot: () => ({
      id: 'company-1',
      legalName: 'Corvo',
      taxId: '11222333000181',
      status: 'ready',
    }),
    getSetupGapsWithCert: () => [],
  };
  const service = {
    findByTaxId: jest.fn().mockResolvedValue(company),
    currentRegimesByCompanyIds: jest.fn().mockResolvedValue(new Map()),
    listPage: jest.fn(),
  };
  const certReader = {
    activeCertificateCounts: jest
      .fn()
      .mockResolvedValue(new Map([['company-1', true]])),
  };
  await expect(
    createCompanyGetHandler(service as never, certReader as never)(
      { tax_id: '11222333000181' },
      { tenantId: 'tenant-1', executionEnvironment: 'test' } as never,
    ),
  ).resolves.toMatchObject({ company: { id: 'company-1' } });
});
