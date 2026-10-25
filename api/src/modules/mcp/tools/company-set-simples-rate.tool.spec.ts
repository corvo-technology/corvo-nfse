import 'reflect-metadata';
import {
  COMPANY_SET_SIMPLES_RATE_TOOL,
  createCompanySetSimplesRateHandler,
} from './company-set-simples-rate.tool';
import { createCompanyGetHandler } from './company-get.tool';

const ctx = { tenantId: 'tenant-1', executionEnvironment: 'test' } as never;
const saved = {
  companyId: 'company-1',
  month: '2026-10',
  totalRate: '6.54',
  issRate: '2.00',
  ibsRate: null,
  cbsRate: null,
  updatedAt: new Date(),
};

describe('company_set_simples_rate', () => {
  const build = () => {
    const companyService = {
      findByTaxId: jest.fn().mockResolvedValue({ id: 'company-1' }),
      findById: jest.fn().mockResolvedValue({ id: 'company-1' }),
    };
    const rates = { put: jest.fn().mockResolvedValue(saved) };
    return {
      companyService,
      rates,
      handler: createCompanySetSimplesRateHandler(
        companyService as never,
        rates as never,
      ),
    };
  };

  it('is described for agents: monthly, informed by the company, no DAS', () => {
    expect(COMPANY_SET_SIMPLES_RATE_TOOL.name).toBe('company_set_simples_rate');
    expect(COMPANY_SET_SIMPLES_RATE_TOOL.description).toContain('DAS');
    expect(COMPANY_SET_SIMPLES_RATE_TOOL.inputSchema.required).toEqual(
      expect.arrayContaining(['month', 'total_rate']),
    );
  });

  it('finds the company by CNPJ and stores the month with two decimal strings', async () => {
    const { handler, companyService, rates } = build();
    const result = await handler(
      {
        company_tax_id: '11.222.333/0001-81',
        month: '2026-10',
        total_rate: 6.54,
        iss_rate: 2,
      },
      ctx,
    );
    expect(companyService.findByTaxId).toHaveBeenCalledWith(
      '11.222.333/0001-81',
      'tenant-1',
      'test',
    );
    expect(rates.put).toHaveBeenCalledWith('company-1', 'tenant-1', '2026-10', {
      totalRate: '6.54',
      issRate: '2.00',
      ibsRate: null,
      cbsRate: null,
    });
    expect(result).toEqual({
      company_id: 'company-1',
      month: '2026-10',
      total_rate: 6.54,
      iss_rate: 2,
      ibs_rate: null,
      cbs_rate: null,
    });
  });

  it('prefers company_id when sent', async () => {
    const { handler, companyService } = build();
    await handler(
      {
        company_id: '01927de2-1234-4890-abcd-ef0123456789',
        month: '2026-10',
        total_rate: 5,
      },
      ctx,
    );
    expect(companyService.findById).toHaveBeenCalled();
    expect(companyService.findByTaxId).not.toHaveBeenCalled();
  });

  it.each([
    [{ month: '2026-10', total_rate: 5 }, 'company'],
    [{ company_tax_id: '1', month: '2026-1', total_rate: 5 }, 'month'],
    [{ company_tax_id: '1', month: '2026-10' }, 'total_rate'],
    [{ company_tax_id: '1', month: '2026-10', total_rate: 101 }, 'total_rate'],
    [{ company_tax_id: '1', month: '2026-10', total_rate: 6.545 }, 'decimal'],
  ])('rejects invalid input %#', async (params, hint) => {
    const { handler, rates } = build();
    await expect(handler(params, ctx)).rejects.toThrow(/Invalid input/);
    expect(rates.put).not.toHaveBeenCalled();
    expect(hint).toBeTruthy();
  });
});

describe('company_get shows the Simples rate of the month', () => {
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
    activeCertificateCounts: jest.fn().mockResolvedValue(new Map()),
  };

  it('returns the resolved rate and whether it is stale', async () => {
    const rates = {
      resolve: jest.fn().mockResolvedValue({
        rate: { ...saved, month: '2026-08' },
        stale: true,
      }),
    };
    const result = await createCompanyGetHandler(
      service as never,
      certReader as never,
      rates as never,
    )({ tax_id: '11222333000181' }, ctx);
    expect(result.simples_rate).toEqual({
      month: '2026-08',
      total_rate: 6.54,
      iss_rate: 2,
      stale: true,
    });
  });

  it('returns null when no rate was informed or the service is absent', async () => {
    const rates = {
      resolve: jest.fn().mockResolvedValue({ rate: null, stale: false }),
    };
    const withRates = await createCompanyGetHandler(
      service as never,
      certReader as never,
      rates as never,
    )({ tax_id: '11222333000181' }, ctx);
    expect(withRates.simples_rate).toBeNull();
    const without = await createCompanyGetHandler(
      service as never,
      certReader as never,
    )({ tax_id: '11222333000181' }, ctx);
    expect(without.simples_rate).toBeNull();
  });
});
