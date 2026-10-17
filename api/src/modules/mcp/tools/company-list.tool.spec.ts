import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import type { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import { createCompanyListHandler } from './company-list.tool';

const context = {
  tenantId: 'tenant-1',
  executionEnvironment: 'test',
} as AuthContext;

function company(id: string, gaps: string[] = [], status = 'ready'): Company {
  return {
    id,
    toSnapshot: () => ({
      id,
      legalName: `Empresa ${id}`,
      tradeName: undefined,
      taxId: '11222333000181',
      municipalityCode: '3550308',
      defaultServiceCode: '010101',
      status,
    }),
    getSetupGapsWithCert: (hasCertificate: boolean) =>
      hasCertificate ? gaps : [...gaps, 'certificate'],
  } as unknown as Company;
}

function setup(
  overrides: Partial<Record<keyof CompanyService, jest.Mock>> = {},
) {
  const service = {
    listPage: jest.fn().mockResolvedValue({
      data: [company('a'), company('b')],
      pagination: { limit: 50, hasMore: false, nextCursor: null },
    }),
    findByTaxId: jest.fn().mockResolvedValue(company('a')),
    currentRegimesByCompanyIds: jest
      .fn()
      .mockResolvedValue(
        new Map([['a', { taxRegime: 'mei', simpleNational: true }]]),
      ),
    ...overrides,
  };
  const certs = {
    activeCertificateCounts: jest
      .fn()
      .mockResolvedValue(new Map([['a', true]])),
  };
  const handler = createCompanyListHandler(
    service as unknown as CompanyService,
    certs as unknown as ICompanyCertificateReader,
  );
  return { service, certs, handler };
}

describe('company_list', () => {
  it('lists companies with the ids an agent needs and readiness', async () => {
    const { handler, service } = setup();
    const result = await handler({}, context);
    expect(service.listPage).toHaveBeenCalledWith(
      'tenant-1',
      { limit: 50, cursor: undefined },
      'test',
    );
    expect(result.next_cursor).toBeNull();
    expect(result.companies[0]).toEqual({
      id: 'a',
      legal_name: 'Empresa a',
      trade_name: null,
      tax_id: '11222333000181',
      municipality_code: '3550308',
      default_service_code: '010101',
      status: 'ready',
      tax_regime: 'mei',
      simple_national: true,
      setup_gaps: [],
      ready_to_issue: true,
    });
  });

  it('flags a company without certificate as not ready', async () => {
    const { handler } = setup();
    const result = await handler({}, context);
    expect(result.companies[1]).toMatchObject({
      id: 'b',
      setup_gaps: ['certificate'],
      ready_to_issue: false,
      tax_regime: null,
      simple_national: false,
    });
  });

  it('never marks a blocked company as ready', async () => {
    const { handler } = setup({
      listPage: jest.fn().mockResolvedValue({
        data: [company('a', [], 'blocked')],
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      }),
    });
    const result = await handler({}, context);
    expect(result.companies[0].ready_to_issue).toBe(false);
  });

  it('looks a company up by CNPJ', async () => {
    const { handler, service } = setup();
    const result = await handler({ tax_id: '11.222.333/0001-81' }, context);
    expect(service.findByTaxId).toHaveBeenCalledWith(
      '11.222.333/0001-81',
      'tenant-1',
      'test',
    );
    expect(result.companies).toHaveLength(1);
    expect(service.listPage).not.toHaveBeenCalled();
  });

  it('returns an empty list when the CNPJ is not registered', async () => {
    const { handler } = setup({
      findByTaxId: jest.fn().mockRejectedValue(new CompanyNotFoundError('x')),
    });
    await expect(
      handler({ tax_id: '00000000000000' }, context),
    ).resolves.toEqual({
      companies: [],
      next_cursor: null,
    });
  });

  it('rejects an out-of-range limit', async () => {
    const { handler } = setup();
    await expect(handler({ limit: 500 }, context)).rejects.toThrow(/limit/);
  });
});
