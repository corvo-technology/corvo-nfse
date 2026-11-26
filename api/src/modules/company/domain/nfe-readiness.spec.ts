import { Company } from './company';
import { nfeReadinessMissing } from './nfe-readiness';
import type { NfeSettings } from './nfe-settings';

const tenantId = '11111111-1111-4111-8111-111111111111';

const company = (address: Record<string, string | undefined> = {}) =>
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
        city: 'São Paulo',
        state: 'SP',
        zip: '01310100',
        ...address,
      },
    },
    tenantId,
  );

const settings = (over: Partial<NfeSettings> = {}): NfeSettings => ({
  companyId: 'c1',
  tenantId,
  stateRegistration: '110042490114',
  crt: 1,
  defaultSeries: 1,
  nfceDefaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
  ...over,
});

describe('nfeReadinessMissing', () => {
  it('is empty for a complete company', () => {
    expect(nfeReadinessMissing(company(), settings())).toEqual([]);
  });

  it('lists a missing zip and IE in order; the CRT follows the tax regime, so it is not asked before any setting', () => {
    expect(nfeReadinessMissing(company({ zip: undefined }), null)).toEqual([
      'address_zip',
      'state_registration',
    ]);
  });

  it('lists the CRT only when the regime has none (settings exist, CRT could not be derived)', () => {
    expect(nfeReadinessMissing(company(), settings({ crt: null }))).toEqual([
      'crt',
    ]);
  });

  it('lists a missing state and city code', () => {
    const noCity = Company.create(
      {
        legalName: 'Empresa Teste LTDA',
        taxId: '11222333000181',
        taxRegime: 'Simples Nacional',
        address: { street: 'Rua A', number: '1', district: 'Centro', zip: '1' },
      },
      tenantId,
    );
    expect(nfeReadinessMissing(noCity, settings())).toEqual([
      'address_city_code',
      'address_state',
    ]);
  });

  it('treats blank settings values as missing', () => {
    expect(
      nfeReadinessMissing(
        company(),
        settings({ stateRegistration: ' ', crt: null }),
      ),
    ).toEqual(['state_registration', 'crt']);
  });
});
