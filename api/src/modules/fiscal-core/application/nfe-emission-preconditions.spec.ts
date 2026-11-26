import type { ConfigService } from '@nestjs/config';
import { Company } from '@/modules/company/domain/company';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type { NfeEnabledAuthorities } from '../domain/nfe-enabled-authorities';
import { NfeEmissionPreconditions } from './nfe-emission-preconditions';

const tenantId = '11111111-1111-4111-8111-111111111111';

const company = (zip: string | undefined | null = '01310100') =>
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
        state: 'SP',
        zip: zip ?? undefined,
      },
    },
    tenantId,
  );

const settings: NfeSettings = {
  companyId: 'c1',
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

function build(options: { production?: boolean; ufEnabled?: boolean } = {}) {
  const isEnabled = jest.fn().mockResolvedValue(options.ufEnabled ?? true);
  const authorities = { isEnabled } as unknown as NfeEnabledAuthorities;
  const config = {
    get: jest.fn(() => options.production ?? false),
  } as unknown as ConfigService;
  return {
    preconditions: new NfeEmissionPreconditions(config, authorities),
    isEnabled,
  };
}

describe('NfeEmissionPreconditions', () => {
  it('lets a complete test company in a released UF through', async () => {
    const { preconditions, isEnabled } = build();
    await expect(
      preconditions.check({
        environment: 'test',
        company: company(),
        settings,
        model: 55,
      }),
    ).resolves.toBeNull();
    expect(isEnabled).toHaveBeenCalledWith('SP', 55, 2);
  });

  it('blocks a live company while production is disabled', async () => {
    const { preconditions } = build();
    await expect(
      preconditions.check({
        environment: 'live',
        company: company(),
        settings,
        model: 55,
      }),
    ).resolves.toMatchObject({
      code: 'NFE_PRODUCTION_DISABLED',
      category: 'CONFIGURATION',
      message: 'NF-e em produção ainda não liberada',
    });
  });

  it('asks for tpAmb 1 when production is enabled', async () => {
    const { preconditions, isEnabled } = build({ production: true });
    await preconditions.check({
      environment: 'live',
      company: company(),
      settings,
      model: 55,
    });
    expect(isEnabled).toHaveBeenCalledWith('SP', 55, 1);
  });

  it('lists what is missing in the company', async () => {
    const { preconditions } = build();
    await expect(
      preconditions.check({
        environment: 'test',
        company: company(null),
        settings: null,
        model: 55,
      }),
    ).resolves.toMatchObject({
      code: 'COMPANY_NFE_INCOMPLETE',
      category: 'CONFIGURATION',
      details: { missing: ['address_zip', 'state_registration'] },
    });
  });

  it('refuses a UF that is not released', async () => {
    const { preconditions } = build({ ufEnabled: false });
    await expect(
      preconditions.check({
        environment: 'test',
        company: company(),
        settings,
        model: 55,
      }),
    ).resolves.toMatchObject({
      code: 'UF_NOT_ENABLED',
      message: 'UF ainda não liberada',
      category: 'CONFIGURATION',
    });
  });

  it('reports the production lock before an incomplete company', async () => {
    const { preconditions } = build({ ufEnabled: false });
    await expect(
      preconditions.check({
        environment: 'live',
        company: company(null),
        settings: null,
        model: 55,
      }),
    ).resolves.toMatchObject({ code: 'NFE_PRODUCTION_DISABLED' });
  });
});
