import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import type { CompanyService } from '../application/company.service';
import type { SimplesRateService } from '../application/simples-rate.service';
import type { SimplesRate } from '../domain/simples-rate';
import { CompanyController } from './company.controller';

const companyId = '11111111-1111-4111-8111-111111111111';
const tenantId = 'tenant-1';
const req = {
  authContext: { activeTenantId: tenantId, executionEnvironment: 'test' },
} as never;
const rate: SimplesRate = {
  companyId,
  month: '2026-10',
  totalRate: '6.54',
  issRate: '2.00',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const build = () => {
  const companyService = {
    findById: jest.fn().mockResolvedValue({ id: companyId }),
  };
  const rates = {
    put: jest.fn().mockResolvedValue(rate),
    list: jest.fn().mockResolvedValue([rate]),
  };
  const controller = new CompanyController(
    companyService as unknown as CompanyService,
    {} as never,
    {} as never,
    {} as never,
    rates as unknown as SimplesRateService,
  );
  return { controller, companyService, rates };
};

describe('CompanyController Simples rates', () => {
  it('PUT scopes the company by tenant and environment and stores the month', async () => {
    const { controller, companyService, rates } = build();
    const result = await controller.putSimplesRate(
      companyId,
      '2026-10',
      { totalRate: '6.54', issRate: '2.00' },
      req,
    );
    expect(companyService.findById).toHaveBeenCalledWith(
      companyId,
      tenantId,
      'test',
    );
    expect(rates.put).toHaveBeenCalledWith(companyId, tenantId, '2026-10', {
      totalRate: '6.54',
      issRate: '2.00',
    });
    expect(result).toEqual({ data: rate });
  });

  it('GET lists the rates of the company', async () => {
    const { controller, companyService, rates } = build();
    const result = await controller.listSimplesRates(companyId, req);
    expect(companyService.findById).toHaveBeenCalledWith(
      companyId,
      tenantId,
      'test',
    );
    expect(rates.list).toHaveBeenCalledWith(companyId, tenantId);
    expect(result).toEqual({ data: [rate] });
  });

  it('declares the routes and permissions', () => {
    const put = CompanyController.prototype.putSimplesRate;
    const list = CompanyController.prototype.listSimplesRates;
    expect(Reflect.getMetadata(PATH_METADATA, put)).toBe(
      ':id/simples-rates/:month',
    );
    expect(Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, put)).toBe(
      'nfse.companies.manage',
    );
    expect(Reflect.getMetadata(PATH_METADATA, list)).toBe(':id/simples-rates');
    expect(Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, list)).toBe(
      'nfse.companies.view',
    );
  });
});

describe('CompanyController create registry warnings', () => {
  const company = {
    id: companyId,
    toSnapshot: () => ({ id: companyId }),
    getSetupGapsWithCert: () => [],
  };
  const build = (warnings: unknown[]) => {
    const companyService = {
      create: jest.fn().mockResolvedValue(company),
      currentRegime: jest.fn().mockResolvedValue(null),
      registryWarnings: jest.fn().mockResolvedValue(warnings),
    };
    return {
      companyService,
      controller: new CompanyController(
        companyService as unknown as CompanyService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };
  const dto = {
    legalName: 'Empresa',
    taxId: '11222333000181',
    taxRegime: 'MEI',
    municipalityCode: '3550308',
  } as never;

  it('adds the warnings to the response when the registry disagrees', async () => {
    const { controller, companyService } = build([
      { code: 'TAX_REGIME_REGISTRY_MISMATCH', message: 'x' },
    ]);
    const result = await controller.create(dto, {
      authContext: {
        activeTenantId: tenantId,
        executionEnvironment: 'test',
        authUserId: 'u',
      },
    } as never);
    expect(result.data).toMatchObject({
      warnings: [{ code: 'TAX_REGIME_REGISTRY_MISMATCH' }],
    });
    expect(companyService.registryWarnings).toHaveBeenCalledWith(
      company,
      'MEI',
    );
  });

  it('keeps the response unchanged without warnings', async () => {
    const { controller } = build([]);
    const result = await controller.create(dto, {
      authContext: {
        activeTenantId: tenantId,
        executionEnvironment: 'test',
        authUserId: 'u',
      },
    } as never);
    expect(result.data).not.toHaveProperty('warnings');
  });
});
