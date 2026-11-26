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

function build(
  c: Company,
  regime: string | null = 'Simples Nacional',
  stored: NfeSettings | null = null,
) {
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
    find: jest.fn().mockResolvedValue(stored),
    upsert: jest.fn().mockResolvedValue(saved),
  } as unknown as jest.Mocked<ICompanyNfeSettingsRepository>;
  const companies = {
    findById: jest.fn().mockResolvedValue(c),
    currentRegime: jest.fn().mockResolvedValue({
      taxRegime: regime,
      simpleNational: regime !== null,
      specialRegime: null,
    }),
  } as unknown as CompanyService;
  return { service: new CompanyNfeSettingsService(companies, repo), repo };
}

const settingsRow = (companyId: string): NfeSettings => ({
  companyId,
  tenantId,
  stateRegistration: '110042490114',
  crt: null,
  defaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
});

describe('CompanyNfeSettingsService', () => {
  it('shows the defaults and what is missing before any setting', async () => {
    const { service } = build(company('SP'));
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({
      stateRegistration: null,
      crt: null,
      taxRegime: 'Simples Nacional',
      defaultSeries: 1,
      defaultCsosn: '102',
      missing: ['state_registration'],
    });
  });

  it('shows the CRT that follows the tax regime and does not list it as missing', async () => {
    const c = company('SP');
    const row = { ...settingsRow(c.id), crt: 1 as const };
    const { service } = build(c, 'Simples Nacional', row);
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({ crt: 1, taxRegime: 'Simples Nacional' });
    expect(view.missing).not.toContain('crt');
  });

  it('lists the CRT as missing only for a regime NF-e does not cover', async () => {
    const c = company('SP');
    const row = { ...settingsRow(c.id), crt: null };
    const { service } = build(c, 'Lucro Presumido', row);
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({ crt: null, taxRegime: 'Lucro Presumido' });
    expect(view.missing).toEqual(['crt']);
  });

  it('saves a valid IE with the defaults filled in, digits only', async () => {
    const { service, repo } = build(company('SP'));
    const view = await service.update('c', tenantId, 'test', {
      stateRegistration: '110.042.490.114',
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      'c',
      tenantId,
      expect.objectContaining({
        stateRegistration: '110042490114',
        crt: null,
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
