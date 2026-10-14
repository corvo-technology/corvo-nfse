import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  Obligation,
  TaxApplicability,
} from './applicability/tax-applicability';
import type { ServiceTaxClassification } from './classification/service-tax-classification';
import type { FiscalContext, FiscalWarning } from './fiscal-context';
import type { FiscalError } from './fiscal-error';
import type { LegacyTaxResult } from './legacy/legacy-tax-result';
import type { NormalizedInvoice } from './normalized-invoice';
import type { RtcTaxResult } from './rtc/rtc-tax-result';
import type { FiscalCalculationResult } from './fiscal-calculation-result';
import { buildFiscalCalculationResult } from './result-builder';

const REQUIRED: Obligation = { status: 'REQUIRED' };
const na = (reason = 'not_applicable'): Obligation => ({
  status: 'NOT_APPLICABLE',
  reason,
});

const invoice = (overrides: Partial<NormalizedInvoice> = {}): NormalizedInvoice => ({
  invoiceId: 'inv-1',
  tenantId: 'ten-1',
  environment: 'test',
  company: {
    id: 'comp-1',
    taxId: '11222333000181',
    municipalityCode: '3550308',
    municipalRegistration: null,
  },
  competenceDate: '2026-12-10',
  grossAmount: '1000.00',
  discountAmount: '0.00',
  service: {
    code: '010601',
    municipalityCode: '3550308',
    description: null,
    fiscal: null,
    serviceProfileId: 'sp-1',
  },
  customer: { kind: 'CNPJ', taxId: '12345678000199', municipalityCode: '3550308' },
  ...overrides,
});

const profile = (overrides: Partial<CompanyFiscalProfile> = {}): CompanyFiscalProfile => ({
  id: 'cfp-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'LUCRO_PRESUMIDO',
  simpleNational: false,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'registration_wizard',
  reviewStatus: 'approved',
  reviewedBy: 'usr-1',
  reviewedAt: new Date('2026-01-02T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const classification = (
  overrides: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '010601',
  municipalServiceCode: null,
  nbsCode: '010601001',
  cst: '000',
  classCode: '060101',
  operationIndicator: '000000',
  source: 'company_service_profile',
  serviceProfileId: 'sp-1',
  operationNature: 'SERVICE',
  iss: {
    taxation: 'NORMAL',
    rate: '3',
    withholdingDefault: false,
    incidenceMunicipalityCode: '3550308',
  },
  withholding: { policy: 'NONE_CONFIRMED', rates: {} },
  catalogVersions: { nbs: '2026.1' },
  catalogValidated: true,
  justification: 'company service profile',
  ...overrides,
});

const applicability = (overrides: Partial<TaxApplicability> = {}): TaxApplicability => ({
  strategy: 'regular',
  customerRequired: true,
  iss: REQUIRED,
  issWithheld: na('no ISS withholding configured'),
  federalWithholding: na('NONE_CONFIRMED policy'),
  cbs: REQUIRED,
  ibs: REQUIRED,
  specialTreatment: na('no special treatment'),
  collectionWaived: true,
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 214/2025', 'LC 116/2003'],
  ...overrides,
});

const meiApplicability = (overrides: Partial<TaxApplicability> = {}): TaxApplicability =>
  applicability({
    strategy: 'mei',
    customerRequired: false,
    iss: na('ISS recolhido no DAS-MEI'),
    cbs: na('MEI nao destaca IBS/CBS na fase de teste de 2026'),
    ibs: na('MEI nao destaca IBS/CBS na fase de teste de 2026'),
    collectionWaived: false,
    legalReferences: ['LC 123/2006'],
    ...overrides,
  });

const legacyTaxes = (overrides: Partial<LegacyTaxResult> = {}): LegacyTaxResult => ({
  iss: { base: '1000.00', rate: '3', amount: '30.00' },
  issWithheld: false,
  issResponsible: 'PROVIDER',
  withholdings: [],
  netReceivableAmount: '970.00',
  ...overrides,
});

const rtcTaxes = (overrides: Partial<RtcTaxResult> = {}): RtcTaxResult => ({
  calculatorVersion: 'fake-2026.1',
  cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
  ibsState: { base: '1000.00', rate: '0', amount: '0.00' },
  ibsCity: { base: '1000.00', rate: '0.1', amount: '1.00' },
  ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
  legalReferences: ['LC 214/2025'],
  calculationMemory: [{ source: 'fake-rtc' }],
  collectionWaived: true,
  ...overrides,
});

const context = (overrides: Partial<FiscalContext> = {}): FiscalContext => {
  const entry = <K extends keyof FiscalContext>(
    key: K,
    fallback: Exclude<FiscalContext[K], undefined>,
  ): Partial<Pick<FiscalContext, K>> => {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
      return { [key]: fallback } as unknown as Partial<Pick<FiscalContext, K>>;
    }
    const value = overrides[key];
    return value === undefined
      ? {}
      : ({ [key]: value } as unknown as Partial<Pick<FiscalContext, K>>);
  };
  return {
    invoice: overrides.invoice ?? invoice(),
    ...entry('companyProfile', profile()),
    ...entry('classification', classification()),
    ...entry('applicability', applicability()),
    ...entry('legacyTaxes', legacyTaxes()),
    ...entry('rtcTaxes', rtcTaxes()),
    warnings: overrides.warnings ?? [],
    trace: overrides.trace ?? [],
  };
};

const resultOf = (ctx: FiscalContext): FiscalCalculationResult => {
  const result = buildFiscalCalculationResult(ctx);
  if (result.ok === false) {
    throw new Error(`expected a fiscal calculation result, got ${result.error.code}`);
  }
  return result.value;
};

const errorOf = (ctx: FiscalContext): FiscalError => {
  const result = buildFiscalCalculationResult(ctx);
  if (result.ok === true) throw new Error('expected the build to fail');
  return result.error;
};

describe('buildFiscalCalculationResult', () => {
  it('builds the complete result for a regular regime with legacy and RTC taxes', () => {
    const result = resultOf(context());
    expect(result).toMatchObject({
      operationId: 'inv-1',
      companyId: 'comp-1',
      competenceDate: '2026-12-10',
      taxRegime: 'LUCRO_PRESUMIDO',
      profileId: 'cfp-1',
      taxableAmounts: { gross: '1000.00', discount: '0.00', iss: '1000.00', ibsCbs: '1000.00' },
      taxes: {
        iss: { base: '1000.00', rate: '3', amount: '30.00' },
        cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
        ibsState: { base: '1000.00', rate: '0', amount: '0.00' },
        ibsCity: { base: '1000.00', rate: '0.1', amount: '1.00' },
        ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
      },
      withholdings: [],
      netReceivableAmount: '970.00',
      collectionWaived: true,
      calculationSource: 'legacy+rtc',
      calculatorVersion: 'fake-2026.1',
      catalogVersions: { nbs: '2026.1' },
      rulesVersion: '2026.10-r1',
      legalReferences: ['LC 214/2025', 'LC 116/2003'],
      warnings: [],
      requiresReview: false,
      calculationMemory: [{ source: 'fake-rtc' }],
    });
    expect(result.classification).toEqual(classification());
    expect(result.applicability).toEqual(applicability());
    expect(result.trace).toEqual([]);
  });

  it('builds an empty result for MEI in 2026', () => {
    const result = resultOf(
      context({
        invoice: invoice({ grossAmount: '50.00', service: { ...invoice().service, code: '060101' } }),
        companyProfile: profile({ taxRegime: 'MEI' }),
        classification: classification({ serviceCode: '060101', iss: { ...classification().iss, rate: null } }),
        applicability: meiApplicability(),
        legacyTaxes: undefined,
        rtcTaxes: undefined,
      }),
    );
    expect(result.taxes).toEqual({});
    expect(result.calculationSource).toBe('none');
    expect(result.netReceivableAmount).toBe('50.00');
    expect(result.withholdings).toEqual([]);
    expect(result.calculatorVersion).toBeNull();
    expect(result.calculationMemory).toEqual([]);
    expect(result.collectionWaived).toBe(false);
    expect(result.requiresReview).toBe(false);
  });

  it('builds a legacy-only result when IBS/CBS is not yet an obligation', () => {
    const result = resultOf(
      context({
        invoice: invoice({ competenceDate: '2026-09-15' }),
        applicability: applicability({
          cbs: na('obrigacao de informacao ainda nao vigente'),
          ibs: na('obrigacao de informacao ainda nao vigente'),
          collectionWaived: false,
        }),
        rtcTaxes: undefined,
      }),
    );
    expect(result.calculationSource).toBe('legacy');
    expect(result.taxes).toEqual({ iss: { base: '1000.00', rate: '3', amount: '30.00' } });
    expect(result.calculationMemory).toEqual([]);
  });

  it('builds an RTC-only result when ISS is exempt', () => {
    const result = resultOf(
      context({
        invoice: invoice({ competenceDate: '2027-03-10' }),
        classification: classification({
          iss: { taxation: 'EXEMPT', rate: null, withholdingDefault: false, incidenceMunicipalityCode: null },
        }),
        applicability: applicability({
          iss: na('ISS is exempt'),
          collectionWaived: false,
        }),
        legacyTaxes: undefined,
        rtcTaxes: rtcTaxes({
          cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
          ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
          collectionWaived: false,
        }),
      }),
    );
    expect(result.calculationSource).toBe('rtc');
    expect(result.taxes).toEqual({
      cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
      ibsState: { base: '1000.00', rate: '0', amount: '0.00' },
      ibsCity: { base: '1000.00', rate: '0.1', amount: '1.00' },
      ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
    });
    expect(result.collectionWaived).toBe(false);
    expect(result.netReceivableAmount).toBe('1000.00');
  });

  it('fails with FISCAL_VALIDATION_FAILED and the field issues when MEI carries a calculated ISS', () => {
    const error = errorOf(
      context({ companyProfile: profile({ taxRegime: 'MEI' }) }),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'VALIDATION',
      retryable: false,
    });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({ field: 'legacyTaxes.iss', code: 'TAX_CALCULATION_UNSUPPORTED' }),
    );
  });

  it('fails with FISCAL_VALIDATION_FAILED when IBS/CBS is required without RTC taxes', () => {
    const error = errorOf(context({ rtcTaxes: undefined }));
    expect(error).toMatchObject({ code: 'FISCAL_VALIDATION_FAILED', category: 'VALIDATION' });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({ field: 'rtcTaxes', code: 'TAX_CALCULATION_UNAVAILABLE' }),
    );
  });

  it('fails with FISCAL_VALIDATION_FAILED when the ISS base differs from gross minus discount', () => {
    const error = errorOf(
      context({
        legacyTaxes: legacyTaxes({ iss: { base: '1000.00', rate: '3', amount: '30.00' } }),
        invoice: invoice({ discountAmount: '100.00' }),
      }),
    );
    expect(error).toMatchObject({ code: 'FISCAL_VALIDATION_FAILED' });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({ field: 'legacyTaxes.iss.base', code: 'ISS_BASE_MISMATCH' }),
    );
  });

  it('fails with FISCAL_VALIDATION_FAILED when withholdings exceed the discounted base', () => {
    const error = errorOf(
      context({
        legacyTaxes: legacyTaxes({
          iss: null,
          withholdings: [{ tax: 'INSS', base: '1000.00', rate: '11', amount: '1000.01' }],
        }),
      }),
    );
    expect(error).toMatchObject({ code: 'FISCAL_VALIDATION_FAILED' });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({ field: 'withholdings', code: 'WITHHOLDINGS_EXCEED_NET' }),
    );
  });

  it('produces an immutable result at the top level and inside taxes', () => {
    const result = resultOf(context());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.taxes)).toBe(true);
    expect(Object.isFrozen(result.taxes.iss)).toBe(true);
    expect(Object.isFrozen(result.withholdings)).toBe(true);
  });

  it('is deterministic and does not carry a calculatedAt timestamp', () => {
    const ctx = context();
    const first = buildFiscalCalculationResult(ctx);
    const second = buildFiscalCalculationResult(ctx);
    if (first.ok === false || second.ok === false) throw new Error('expected both builds to succeed');
    expect(second.value).toEqual(first.value);
    expect(second.value).not.toHaveProperty('calculatedAt');
    expect(Object.keys(second.value)).toEqual(Object.keys(first.value));
  });

  it('marks the result for review when a REVIEW warning is present', () => {
    const warnings: FiscalWarning[] = [
      { code: 'REVIEW_IBSCBS_TRANSITION', message: 'IBS/CBS transition year', step: 'FiscalValidator' },
    ];
    expect(resultOf(context({ warnings })).requiresReview).toBe(true);
  });

  it('marks the result for review when the fiscal profile is not approved', () => {
    const result = resultOf(context({ companyProfile: profile({ reviewStatus: 'unreviewed' }) }));
    expect(result.requiresReview).toBe(true);
  });

  it('marks the result for review in the 2027 transition year', () => {
    const result = resultOf(context({ invoice: invoice({ competenceDate: '2027-06-01' }) }));
    expect(result.requiresReview).toBe(true);
  });

  it('marks the result for review when IBS/CBS was tolerated by Sefin', () => {
    const warnings: FiscalWarning[] = [
      {
        code: 'IBS_CBS_NOT_DECLARED_TOLERATED',
        message: 'IBS/CBS not declared inside the Sefin tolerance window',
        step: 'RtcTaxCalculator',
      },
    ];
    const result = resultOf(
      context({
        rtcTaxes: undefined,
        warnings,
      }),
    );
    expect(result.requiresReview).toBe(true);
  });

  it('marks the result for review when the applicability requires a special treatment', () => {
    const result = resultOf(
      context({
        applicability: applicability({
          specialTreatment: { status: 'UNSUPPORTED', reason: 'partner-salon scenario not supported' },
        }),
      }),
    );
    expect(result.requiresReview).toBe(true);
  });

  it('marks an unsupported regime for review', () => {
    const result = resultOf(
      context({ companyProfile: profile({ taxRegime: 'OUTRO_REGIME' }) }),
    );
    expect(result.requiresReview).toBe(true);
  });

  it('does not throw on an invalid monetary string, failing with a Result error instead', () => {
    expect(() =>
      buildFiscalCalculationResult(context({ invoice: invoice({ grossAmount: 'not-a-number' }) })),
    ).not.toThrow();
    expect(
      buildFiscalCalculationResult(context({ invoice: invoice({ grossAmount: 'not-a-number' }) })),
    ).toMatchObject({ ok: false, error: { code: 'FISCAL_VALIDATION_FAILED' } });
  });
});
