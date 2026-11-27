import type { ConfigService } from '@nestjs/config';
import { Company } from '@/modules/company/domain/company';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
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
  nfceDefaultSeries: 1,
  nfceAutoOffline: false,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
};

function build(options: { production?: boolean } = {}) {
  const config = {
    get: jest.fn(() => options.production ?? false),
  } as unknown as ConfigService;
  return new NfeEmissionPreconditions(config);
}

describe('NfeEmissionPreconditions', () => {
  it('lets a complete test company through, for any UF', () => {
    const preconditions = build();
    for (const model of [55, 65] as const)
      expect(
        preconditions.check({
          environment: 'test',
          company: company(),
          settings,
          model,
        }),
      ).toBeNull();
  });

  it('blocks a live company while production is disabled', () => {
    expect(
      build().check({
        environment: 'live',
        company: company(),
        settings,
        model: 55,
      }),
    ).toMatchObject({
      code: 'NFE_PRODUCTION_DISABLED',
      category: 'CONFIGURATION',
      message: 'NF-e em produção ainda não liberada',
    });
  });

  it('lets a live company through when production is enabled', () => {
    const preconditions = build({ production: true });
    expect(preconditions.productionEnabled()).toBe(true);
    expect(
      preconditions.check({
        environment: 'live',
        company: company(),
        settings,
        model: 55,
      }),
    ).toBeNull();
  });

  it('lists what is missing in the company', () => {
    expect(
      build().check({
        environment: 'test',
        company: company(null),
        settings: null,
        model: 55,
      }),
    ).toMatchObject({
      code: 'COMPANY_NFE_INCOMPLETE',
      category: 'CONFIGURATION',
      details: { missing: ['address_zip', 'state_registration'] },
    });
  });

  it('reports the production lock before an incomplete company', () => {
    expect(
      build().check({
        environment: 'live',
        company: company(null),
        settings: null,
        model: 55,
      }),
    ).toMatchObject({ code: 'NFE_PRODUCTION_DISABLED' });
  });

  it('locks production for the NFC-e too, naming it', () => {
    expect(
      build().check({
        environment: 'live',
        company: company(),
        settings,
        model: 65,
      }),
    ).toMatchObject({
      code: 'NFE_PRODUCTION_DISABLED',
      message: 'NFC-e em produção ainda não liberada',
    });
  });
});
