import { UnprocessableEntityException } from '@nestjs/common';
import { Company } from '../domain/company';
import type { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import type { NfeSettings } from '../domain/nfe-settings';
import { CompanyNfeSettingsService } from './company-nfe-settings.service';
import type { CompanyService } from './company.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

const company = (state?: string) =>
  Company.create(
    {
      legalName: 'Empresa Teste LTDA',
      taxId: '11222333000181',
      taxRegime: 'Simples Nacional',
      municipalityCode: '3550308',
      address: {
        street: 'Rua A',
        number: '10',
        district: 'Centro',
        state,
        zip: '01310100',
      },
    },
    tenantId,
  );

function build(c: Company) {
  const saved: NfeSettings = {
    companyId: c.id,
    tenantId,
    stateRegistration: '110042490114',
    crt: 1,
    defaultSeries: 1,
    defaultNatOp: 'Venda de mercadoria',
    defaultCsosn: '102',
    defaultOrigin: 0,
    defaultPisCst: '49',
    defaultCofinsCst: '49',
    enabledAt: null,
  };
  const repo = {
    find: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(saved),
  } as unknown as jest.Mocked<ICompanyNfeSettingsRepository>;
  const companies = {
    findById: jest.fn().mockResolvedValue(c),
  } as unknown as CompanyService;
  return { service: new CompanyNfeSettingsService(companies, repo), repo };
}

describe('CompanyNfeSettingsService', () => {
  it('shows the defaults and what is missing before any setting', async () => {
    const { service } = build(company('SP'));
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({
      stateRegistration: null,
      crt: null,
      defaultSeries: 1,
      defaultCsosn: '102',
      missing: ['state_registration', 'crt'],
    });
  });

  it('saves a valid IE with the defaults filled in, digits only', async () => {
    const { service, repo } = build(company('SP'));
    const view = await service.update('c', tenantId, 'test', {
      stateRegistration: '110.042.490.114',
      crt: 1,
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      'c',
      tenantId,
      expect.objectContaining({
        stateRegistration: '110042490114',
        defaultNatOp: 'Venda de mercadoria',
        defaultPisCst: '49',
      }),
    );
    expect(view.missing).toEqual([]);
  });

  it('refuses an invalid IE with STATE_REGISTRATION_INVALID', async () => {
    const { service, repo } = build(company('SP'));
    const attempt = service.update('c', tenantId, 'test', {
      stateRegistration: '110042490115',
      crt: 1,
    });
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'STATE_REGISTRATION_INVALID' },
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('refuses an IE when the company has no state yet', async () => {
    const { service } = build(company());
    await expect(
      service.update('c', tenantId, 'test', {
        stateRegistration: '110042490114',
        crt: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STATE_REGISTRATION_INVALID' },
    });
  });
});
