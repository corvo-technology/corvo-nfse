import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { OperationNature } from '@/modules/company/domain/service-tax-profile';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalCustomer } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import type { TaxRule } from '@/modules/invoice/domain/fiscal/policies/tax-rule';
import {
  allowsAnonymousCustomer,
  requiresIbsCbs,
  requiresIssWithholding,
  requiresSpecialTreatment,
} from './specifications';

const fullProfile = (
  over: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'profile-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  taxRegime: 'LUCRO_PRESUMIDO',
  simpleNational: false,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'manual',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...over,
});

const classificationWith = (
  over: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '060101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  source: 'official_catalog',
  serviceProfileId: null,
  operationNature: 'SERVICE',
  iss: {
    taxation: 'NORMAL',
    rate: '3',
    withholdingDefault: false,
    incidenceMunicipalityCode: null,
  },
  withholding: { policy: 'NONE_CONFIRMED', rates: {} },
  catalogVersions: {},
  catalogValidated: false,
  justification: 'service code found in official catalog',
  ...over,
});

describe('allowsAnonymousCustomer', () => {
  const subject = (
    regime: CompanyFiscalProfile['taxRegime'],
    operationNature: OperationNature = 'SERVICE',
  ) =>
    allowsAnonymousCustomer({
      regime,
      competenceDate: '2026-10-13',
      operationNature,
    });

  it('allows an anonymous customer for MEI service operations', () => {
    expect(subject('MEI')).toMatchObject({ satisfied: true });
  });

  it('allows an anonymous customer for Simples Nacional service operations', () => {
    expect(subject('SIMPLES_NACIONAL')).toMatchObject({ satisfied: true });
  });

  it('does not allow an anonymous customer for regular regimes', () => {
    const presumido = subject('LUCRO_PRESUMIDO');
    expect(presumido.satisfied).toBe(false);
    expect(presumido.reason).toBe(
      'regular tax regimes require an identified customer',
    );
    expect(subject('LUCRO_REAL').satisfied).toBe(false);
  });

  it('does not allow an anonymous customer outside SERVICE operations', () => {
    expect(subject('MEI', 'GOODS').satisfied).toBe(false);
    expect(subject('SIMPLES_NACIONAL', 'PARTNER_SALON').satisfied).toBe(false);
  });
});

describe('requiresIssWithholding', () => {
  const cnpjCustomer: FiscalCustomer = {
    kind: 'CNPJ',
    taxId: '11222333000181',
    municipalityCode: '3550308',
  };
  const cpfCustomer: FiscalCustomer = {
    kind: 'CPF',
    taxId: '12345678909',
    municipalityCode: null,
  };

  it('is satisfied when withholding is configured and the customer is a CNPJ', () => {
    const classification = classificationWith({
      iss: {
        taxation: 'NORMAL',
        rate: '3',
        withholdingDefault: true,
        incidenceMunicipalityCode: null,
      },
    });
    expect(
      requiresIssWithholding({ customer: cnpjCustomer, classification }),
    ).toMatchObject({
      satisfied: true,
    });
  });

  it('is not satisfied when the service default is off, with the plan reason', () => {
    const result = requiresIssWithholding({
      customer: cnpjCustomer,
      classification: classificationWith(),
    });
    expect(result).toMatchObject({
      satisfied: false,
      reason: 'no ISS withholding configured for this customer/service',
    });
  });

  it('is not satisfied for a CPF customer', () => {
    const classification = classificationWith({
      iss: {
        taxation: 'NORMAL',
        rate: '3',
        withholdingDefault: true,
        incidenceMunicipalityCode: null,
      },
    });
    expect(
      requiresIssWithholding({ customer: cpfCustomer, classification })
        .satisfied,
    ).toBe(false);
  });

  it('is not satisfied without a customer', () => {
    const classification = classificationWith({
      iss: {
        taxation: 'NORMAL',
        rate: '3',
        withholdingDefault: true,
        incidenceMunicipalityCode: null,
      },
    });
    expect(
      requiresIssWithholding({ customer: null, classification }).satisfied,
    ).toBe(false);
  });
});

describe('requiresIbsCbs', () => {
  const policy = new TaxTransitionPolicy();

  it('is not satisfied before the information obligation takes effect', () => {
    const result = requiresIbsCbs({
      competenceDate: '2026-09-30',
      serviceCode: '060101',
      policy,
    });
    expect(result).toMatchObject({
      satisfied: false,
      reason: 'obrigação de informação ainda não vigente',
    });
  });

  it('is satisfied from the general milestone on', () => {
    for (const date of ['2026-10-01', '2026-10-13', '2027-02-01']) {
      expect(
        requiresIbsCbs({ competenceDate: date, serviceCode: '060101', policy })
          .satisfied,
      ).toBe(true);
    }
  });

  it('honours the specific-category deadline for listed service codes', () => {
    const specificRule: TaxRule = {
      ruleKey: 'nfse.ibscbs-information',
      validFrom: '2026-10-01',
      validUntil: null,
      legalReference: 'Ato Conjunto RFB/CGIBS nº 4/2026',
      sourceUrl:
        'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc',
      status: 'published',
      parameters: {
        generalFrom: '2026-10-01',
        specificCategoriesFrom: '2026-12-01',
        sefinToleranceUntil: '2026-12-31',
        specificCategoryServiceCodes: ['666666'],
      },
    };
    const custom = new TaxTransitionPolicy([specificRule]);
    expect(
      requiresIbsCbs({
        competenceDate: '2026-11-15',
        serviceCode: '666666',
        policy: custom,
      }),
    ).toMatchObject({ satisfied: false });
    expect(
      requiresIbsCbs({
        competenceDate: '2026-11-15',
        serviceCode: '060101',
        policy: custom,
      }).satisfied,
    ).toBe(true);
    expect(
      requiresIbsCbs({
        competenceDate: '2026-12-01',
        serviceCode: '666666',
        policy: custom,
      }).satisfied,
    ).toBe(true);
  });
});

describe('requiresSpecialTreatment', () => {
  const subject = (operationNature: OperationNature) =>
    requiresSpecialTreatment({
      classification: classificationWith({ operationNature }),
      profile: fullProfile(),
    });

  it('is satisfied for plain service operations', () => {
    expect(subject('SERVICE')).toMatchObject({ satisfied: true });
  });

  it('rejects goods and mixed operations with the plan reason', () => {
    expect(subject('GOODS')).toMatchObject({
      satisfied: false,
      reason: 'goods/mixed operations require NF-e/NFC-e',
    });
    expect(subject('MIXED')).toMatchObject({
      satisfied: false,
      reason: 'goods/mixed operations require NF-e/NFC-e',
    });
  });

  it('flags partner-salon operations for fiscal review with the plan reason', () => {
    expect(subject('PARTNER_SALON')).toMatchObject({
      satisfied: false,
      reason: 'partner-salon scenario not supported; fiscal review required',
    });
  });
});
