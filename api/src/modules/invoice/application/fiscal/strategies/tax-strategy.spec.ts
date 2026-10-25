import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type {
  FiscalCustomer,
  NormalizedInvoice,
} from '@/modules/invoice/domain/fiscal/normalized-invoice';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import { err, type Result } from '@/modules/invoice/domain/fiscal/result';
import { MeiTaxStrategy } from './mei-tax.strategy';
import { ConfigService } from '@nestjs/config';
import { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import { RegularTaxStrategy } from './regular-tax.strategy';
import { SimplesNacionalTaxStrategy } from './simples-nacional-tax.strategy';
import { TaxStrategyResolver } from './tax-strategy.resolver';
import type { StrategyPlanResult, TaxStrategy } from './tax-strategy';

describe('strategies', () => {
  const policy = new TaxTransitionPolicy();
  const resolver = new TaxStrategyResolver([
    new MeiTaxStrategy(),
    new SimplesNacionalTaxStrategy(),
    new RegularTaxStrategy(),
  ]);

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
    simplesIssRate: null,
    validFrom: '2026-01-01',
    validUntil: null,
    source: 'manual',
    reviewStatus: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  });

  const invoiceWith = (
    date: string,
    customer: FiscalCustomer | null,
  ): NormalizedInvoice => ({
    invoiceId: 'invoice-1',
    tenantId: 'tenant-1',
    environment: 'test',
    company: {
      id: 'company-1',
      taxId: '12345678000199',
      municipalityCode: '3550308',
      municipalRegistration: null,
    },
    competenceDate: date,
    grossAmount: '1000.00',
    discountAmount: '0.00',
    service: {
      code: '060101',
      municipalityCode: '3550308',
      description: null,
      fiscal: null,
      serviceProfileId: null,
    },
    customer,
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

  const plan = (
    profile: Partial<CompanyFiscalProfile>,
    over: {
      competenceDate?: string;
      customer?: FiscalCustomer | null;
      classification?: Partial<ServiceTaxClassification>;
    } = {},
  ): Result<StrategyPlanResult, FiscalError> => {
    const full = fullProfile(profile);
    const date = over.competenceDate ?? '2026-10-13';
    const strategy = resolver.resolve(full, date);
    if (!strategy.ok) return strategy;
    return strategy.value.plan({
      invoice: invoiceWith(date, over.customer ?? null),
      profile: full,
      classification: classificationWith(over.classification),
      policy,
    });
  };

  it('MEI 2026: no ISS, no IBS/CBS, anonymous customer allowed', () => {
    const r = plan({ taxRegime: 'MEI' });
    expect(r.ok && r.value).toMatchObject({
      iss: { status: 'NOT_APPLICABLE' },
      cbs: { status: 'NOT_APPLICABLE' },
      ibs: { status: 'NOT_APPLICABLE' },
      customerRequired: false,
    });
  });

  it('MEI 2027: IBS/CBS UNSUPPORTED (never NOT_APPLICABLE)', () => {
    const r = plan({ taxRegime: 'MEI' }, { competenceDate: '2027-02-01' });
    expect(r.ok && r.value.cbs.status).toBe('UNSUPPORTED');
    expect(r.ok && r.value.ibs.status).toBe('UNSUPPORTED');
  });

  it('Simples 2026: no test-phase rate applied', () => {
    const r = plan(
      { taxRegime: 'SIMPLES_NACIONAL', simpleNational: true },
      { competenceDate: '2026-11-15' },
    );
    expect(r.ok && r.value).toMatchObject({
      cbs: { status: 'NOT_APPLICABLE' },
      ibs: { status: 'NOT_APPLICABLE' },
      iss: { status: 'NOT_APPLICABLE' },
      collectionWaived: false,
    });
  });

  it('Simples 2027 without regular option: UNSUPPORTED', () => {
    const r = plan(
      { taxRegime: 'SIMPLES_NACIONAL' },
      { competenceDate: '2027-02-01' },
    );
    expect(r.ok && r.value.cbs.status).toBe('UNSUPPORTED');
    expect(r.ok && r.value.ibs.status).toBe('UNSUPPORTED');
    expect(r.ok && r.value.iss.status).toBe('NOT_APPLICABLE');
  });

  it('Simples 2027 with regular option valid from the competence: IBS/CBS go regular, ISS stays in the DAS', () => {
    const r = plan(
      {
        taxRegime: 'SIMPLES_NACIONAL',
        ibsCbsRegularOption: true,
        ibsCbsRegularFrom: '2027-01-01',
      },
      { competenceDate: '2027-02-01' },
    );
    expect(r.ok && r.value).toMatchObject({
      iss: { status: 'NOT_APPLICABLE', reason: 'ISS recolhido no DAS' },
      cbs: { status: 'REQUIRED' },
      ibs: { status: 'REQUIRED' },
      collectionWaived: false,
    });
  });

  it('Simples ISS withholding required without simplesIssRate: MISSING_CONFIGURATION', () => {
    const r = plan(
      { taxRegime: 'SIMPLES_NACIONAL', simplesIssRate: null },
      {
        customer: cnpjCustomer,
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: null,
            withholdingDefault: true,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.issWithheld).toMatchObject({
      status: 'MISSING_CONFIGURATION',
      missingFields: ['fiscalProfile.simplesIssRate'],
    });
  });

  it('Simples ISS withholding required with simplesIssRate configured: REQUIRED', () => {
    const r = plan(
      { taxRegime: 'SIMPLES_NACIONAL', simplesIssRate: '2.01' },
      {
        customer: cnpjCustomer,
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: null,
            withholdingDefault: true,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.issWithheld).toMatchObject({ status: 'REQUIRED' });
  });

  it('Regular 2026: IBS/CBS REQUIRED with collection waived; customer required', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        customer: cnpjCustomer,
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: '3',
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
          withholding: { policy: 'NONE_CONFIRMED', rates: {} },
        },
      },
    );
    expect(r.ok && r.value).toMatchObject({
      iss: { status: 'REQUIRED' },
      cbs: { status: 'REQUIRED' },
      collectionWaived: true,
      customerRequired: true,
    });
  });

  it('Regular 2027: collectionWaived false', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      { competenceDate: '2027-01-15', customer: cnpjCustomer },
    );
    expect(r.ok && r.value.collectionWaived).toBe(false);
    expect(r.ok && r.value.cbs.status).toBe('REQUIRED');
  });

  it('Regular without ISS rate: MISSING_CONFIGURATION', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: null,
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.iss).toMatchObject({
      status: 'MISSING_CONFIGURATION',
      missingFields: ['service.iss.rate'],
    });
  });

  it('Regular FIXED ISS: UNSUPPORTED', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        classification: {
          iss: {
            taxation: 'FIXED',
            rate: null,
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.iss.status).toBe('UNSUPPORTED');
  });

  it('Regular EXEMPT ISS: UNSUPPORTED (isenção needs the BM/nBM municipal benefit, not modelled)', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        classification: {
          iss: {
            taxation: 'EXEMPT',
            rate: null,
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.iss).toMatchObject({
      status: 'UNSUPPORTED',
      reason:
        'isenção de ISS exige o benefício municipal (BM/nBM) na DPS; ainda não suportado',
    });
  });

  it('Regular NORMAL ISS with rate: REQUIRED (unchanged)', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: '3',
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.iss.status).toBe('REQUIRED');
  });

  it('Regular before 2026-10-01: IBS/CBS NOT_APPLICABLE (obligation not yet effective)', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      { competenceDate: '2026-09-15', customer: cnpjCustomer },
    );
    expect(r.ok && r.value.cbs).toMatchObject({
      status: 'NOT_APPLICABLE',
      reason: 'obrigação de informação ainda não vigente',
    });
    expect(r.ok && r.value.ibs.status).toBe('NOT_APPLICABLE');
  });

  it('CNPJ customer with UNKNOWN withholding policy: federalWithholding MISSING_CONFIGURATION', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        customer: cnpjCustomer,
        classification: { withholding: { policy: 'UNKNOWN', rates: {} } },
      },
    );
    expect(r.ok && r.value.federalWithholding).toMatchObject({
      status: 'MISSING_CONFIGURATION',
      missingFields: ['service.withholdingPolicy'],
    });
  });

  it.each(['MEI', 'SIMPLES_NACIONAL'] as const)(
    '%s with CNPJ customer and UNKNOWN policy: federalWithholding NOT_APPLICABLE',
    (taxRegime) => {
      const r = plan(
        { taxRegime },
        {
          customer: cnpjCustomer,
          classification: { withholding: { policy: 'UNKNOWN', rates: {} } },
        },
      );
      expect(r.ok && r.value.federalWithholding).toMatchObject({
        status: 'NOT_APPLICABLE',
      });
    },
  );

  it('CPF customer: federalWithholding NOT_APPLICABLE', () => {
    const r = plan({ taxRegime: 'LUCRO_PRESUMIDO' }, { customer: cpfCustomer });
    expect(r.ok && r.value.federalWithholding).toMatchObject({
      status: 'NOT_APPLICABLE',
    });
  });

  it('ISS withheld when configured and customer is CNPJ', () => {
    const r = plan(
      { taxRegime: 'LUCRO_PRESUMIDO' },
      {
        customer: cnpjCustomer,
        classification: {
          iss: {
            taxation: 'NORMAL',
            rate: '3',
            withholdingDefault: true,
            incidenceMunicipalityCode: null,
          },
        },
      },
    );
    expect(r.ok && r.value.issWithheld).toMatchObject({ status: 'REQUIRED' });
  });

  it('GOODS nature blocks with OPERATION_DOCUMENT_UNSUPPORTED', () => {
    expect(
      plan(
        { taxRegime: 'MEI' },
        { classification: { operationNature: 'GOODS' } },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_DOCUMENT_UNSUPPORTED' },
    });
  });

  it('PARTNER_SALON: specialTreatment UNSUPPORTED', () => {
    const r = plan(
      { taxRegime: 'MEI' },
      { classification: { operationNature: 'PARTNER_SALON' } },
    );
    expect(r.ok && r.value.specialTreatment).toMatchObject({
      status: 'UNSUPPORTED',
      reason: 'partner-salon scenario not supported; fiscal review required',
    });
  });

  it.each(['OUTRO_REGIME', 'UNKNOWN'] as const)(
    'OUTRO_REGIME / UNKNOWN: TAX_REGIME_UNSUPPORTED (%s)',
    (regime) => {
      expect(
        resolver.resolve(fullProfile({ taxRegime: regime }), '2026-10-13'),
      ).toMatchObject({
        ok: false,
        error: { code: 'TAX_REGIME_UNSUPPORTED', details: { regime } },
      });
    },
  );

  it('resolver rejects when two strategies claim the same profile', () => {
    const stubStrategy = (name: string): TaxStrategy => ({
      name,
      supports: () => true,
      plan: () =>
        err(
          fiscalError({
            code: 'TAX_APPLICABILITY_UNKNOWN',
            category: 'CONFIGURATION',
            message: 'stub strategy never plans',
            step: 'stub',
          }),
        ),
    });
    const ambiguous = new TaxStrategyResolver([
      stubStrategy('first'),
      stubStrategy('second'),
    ]);
    expect(ambiguous.resolve(fullProfile(), '2026-10-13')).toMatchObject({
      ok: false,
      error: {
        code: 'TAX_REGIME_UNSUPPORTED',
        details: { ambiguousStrategies: ['first', 'second'] },
      },
    });
  });

  describe('Anexo I E0583: MEI never has ISS withheld', () => {
    const rolloutFlags = (conformance: boolean) =>
      new RolloutFlagsService(
        new ConfigService({
          rollout: {
            taxRegimeRestriction: { on: false, tenants: '*' },
            fiscalDpsConformance: { on: conformance, tenants: '*' },
            simplesTottrib: { on: false, tenants: '*' },
            fiscal2027SimplesMei: { on: false, tenants: '*' },
            cnpjRegistryCheck: { on: false, tenants: '*' },
            simplesRateMode: { mode: 'off', tenants: '*' },
            simplesRateEnforcedFrom: null,
          },
        }),
      );
    const withholdingClassification = classificationWith({
      iss: {
        taxation: 'NORMAL',
        rate: '3',
        withholdingDefault: true,
        incidenceMunicipalityCode: '3550308',
      },
    });
    const cnpjCustomer: FiscalCustomer = {
      kind: 'CNPJ',
      taxId: '12345678000195',
      municipalityCode: null,
    };
    const plan = (
      regime: 'MEI' | 'SIMPLES_NACIONAL',
      conformance: boolean | undefined,
    ) => {
      const strategy =
        regime === 'MEI'
          ? new MeiTaxStrategy(
              conformance === undefined ? undefined : rolloutFlags(conformance),
            )
          : new SimplesNacionalTaxStrategy();
      return strategy.plan({
        invoice: invoiceWith('2026-12-10', cnpjCustomer),
        profile: fullProfile({
          taxRegime: regime,
          simpleNational: true,
          simplesIssRate: '2.00',
        }),
        classification: withholdingClassification,
        policy,
      });
    };

    it('is NOT_APPLICABLE for a MEI with a CNPJ customer when the conformance flag is on', () => {
      const planned = plan('MEI', true);
      expect(planned.ok && planned.value.issWithheld).toMatchObject({
        status: 'NOT_APPLICABLE',
      });
    });

    it('keeps REQUIRED when the flag is off or not provided', () => {
      for (const flag of [false, undefined]) {
        const planned = plan('MEI', flag);
        expect(planned.ok && planned.value.issWithheld.status).toBe('REQUIRED');
      }
    });

    it('does not change Simples Nacional, which keeps withholding', () => {
      const planned = plan('SIMPLES_NACIONAL', true);
      expect(planned.ok && planned.value.issWithheld.status).toBe('REQUIRED');
    });
  });

  describe('regular regimes with TAX_REGIME_RESTRICTION', () => {
    const rolloutFlags = (restricted: boolean) =>
      new RolloutFlagsService(
        new ConfigService({
          rollout: {
            taxRegimeRestriction: { on: restricted, tenants: '*' },
            fiscalDpsConformance: { on: false, tenants: '*' },
            simplesTottrib: { on: false, tenants: '*' },
            fiscal2027SimplesMei: { on: false, tenants: '*' },
            cnpjRegistryCheck: { on: false, tenants: '*' },
            simplesRateMode: { mode: 'off', tenants: '*' },
            simplesRateEnforcedFrom: null,
          },
        }),
      );

    it('stops resolving Lucro Presumido and Lucro Real when the restriction is on', () => {
      const restricted = new TaxStrategyResolver([
        new MeiTaxStrategy(),
        new SimplesNacionalTaxStrategy(),
        new RegularTaxStrategy(rolloutFlags(true)),
      ]);
      for (const taxRegime of ['LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const) {
        const resolved = restricted.resolve(
          fullProfile({ taxRegime }),
          '2026-12-10',
        );
        expect(resolved.ok).toBe(false);
        expect(!resolved.ok && resolved.error.code).toBe(
          'TAX_REGIME_UNSUPPORTED',
        );
      }
    });

    it('keeps resolving them when the restriction is off', () => {
      const open = new TaxStrategyResolver([
        new MeiTaxStrategy(),
        new SimplesNacionalTaxStrategy(),
        new RegularTaxStrategy(rolloutFlags(false)),
      ]);
      expect(
        open.resolve(fullProfile({ taxRegime: 'LUCRO_REAL' }), '2026-12-10').ok,
      ).toBe(true);
    });
  });
});
