import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  Obligation,
  TaxApplicability,
} from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { LegacyTaxResult } from '@/modules/invoice/domain/fiscal/legacy/legacy-tax-result';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { validateFiscalContext } from './fiscal-validator';

const REQUIRED: Obligation = { status: 'REQUIRED' };
const na = (reason = 'not_applicable'): Obligation => ({
  status: 'NOT_APPLICABLE',
  reason,
});

const invoice = (
  overrides: Partial<NormalizedInvoice> = {},
): NormalizedInvoice => ({
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
  customer: {
    kind: 'CNPJ',
    taxId: '12345678000199',
    municipalityCode: '3550308',
  },
  ...overrides,
});

const profile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'cfp-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'LUCRO_PRESUMIDO',
  simpleNational: false,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
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

const applicability = (
  overrides: Partial<TaxApplicability> = {},
): TaxApplicability => ({
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

const legacyTaxes = (
  overrides: Partial<LegacyTaxResult> = {},
): LegacyTaxResult => ({
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
    trace: [],
  };
};

const withoutProfile = context({ companyProfile: undefined });
const withoutClassification = context({ classification: undefined });
const withoutApplicability = context({ applicability: undefined });
const withoutRtc = context({ rtcTaxes: undefined });

describe('validateFiscalContext', () => {
  it('accepts a complete regular-regime context without issues', () => {
    const { errors } = validateFiscalContext(context());
    expect(errors).toEqual([]);
  });

  it('passes the context warnings through untouched', () => {
    const warnings = [
      {
        code: 'UNCONDITIONAL_DISCOUNT_DEDUCTED',
        message: 'discount deducted',
        step: 'LegacyTaxCalculator',
      },
    ];
    const { errors, warnings: returned } = validateFiscalContext(
      context({ warnings }),
    );
    expect(errors).toEqual([]);
    expect(returned).toEqual(warnings);
  });

  it('flags a missing company fiscal profile', () => {
    const { errors } = validateFiscalContext(withoutProfile);
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'companyProfile',
        code: 'FISCAL_PROFILE_MISSING',
      }),
    );
  });

  it('flags a missing service tax classification', () => {
    const { errors } = validateFiscalContext(withoutClassification);
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification',
        code: 'FISCAL_CLASSIFICATION_REQUIRED',
      }),
    );
  });

  it('flags a missing tax applicability', () => {
    const { errors } = validateFiscalContext(withoutApplicability);
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'applicability',
        code: 'TAX_APPLICABILITY_UNKNOWN',
      }),
    );
  });

  it('flags a classification service code that differs from the invoice service code', () => {
    const { errors } = validateFiscalContext(
      context({ classification: classification({ serviceCode: '999999' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'service.code',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
  });

  it('flags an empty cst next to a present classCode', () => {
    const { errors } = validateFiscalContext(
      context({ classification: classification({ cst: '' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification.cst',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
  });

  it('flags a present classCode without an operationIndicator', () => {
    const { errors } = validateFiscalContext(
      context({ classification: classification({ operationIndicator: null }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification.operationIndicator',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
  });

  it('requires the full code trio when the classification claims catalog validation', () => {
    const { errors } = validateFiscalContext(
      context({
        classification: classification({
          classCode: null,
          cst: null,
          operationIndicator: null,
          catalogValidated: true,
        }),
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification.classCode',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification.cst',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'classification.operationIndicator',
        code: 'FISCAL_CLASSIFICATION_INVALID',
      }),
    );
  });

  it('allows an unvalidated classification without classCode, cst and operationIndicator', () => {
    const { errors } = validateFiscalContext(
      context({
        classification: classification({
          classCode: null,
          cst: null,
          operationIndicator: null,
          catalogValidated: false,
        }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('flags required IBS/CBS without RTC taxes', () => {
    const { errors } = validateFiscalContext(withoutRtc);
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNAVAILABLE',
      }),
    );
  });

  it('tolerates required IBS/CBS without RTC taxes when the Sefin tolerance warning is present', () => {
    const { errors } = validateFiscalContext(
      context({
        rtcTaxes: undefined,
        warnings: [
          {
            code: 'IBS_CBS_NOT_DECLARED_TOLERATED',
            message: 'IBS/CBS not declared inside the Sefin tolerance window',
            step: 'RtcTaxCalculator',
          },
        ],
      }),
    );
    expect(errors).toEqual([]);
  });

  it('flags required ISS without a calculated ISS amount', () => {
    const { errors } = validateFiscalContext(
      context({ legacyTaxes: legacyTaxes({ iss: null }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.iss',
        code: 'TAX_CALCULATION_UNAVAILABLE',
      }),
    );
  });

  it('flags an ISS base different from gross minus discount', () => {
    const { errors } = validateFiscalContext(
      context({
        legacyTaxes: legacyTaxes({
          iss: { base: '999.00', rate: '3', amount: '29.97' },
        }),
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.iss.base',
        code: 'ISS_BASE_MISMATCH',
      }),
    );
  });

  it('accepts an ISS base equal to gross minus the unconditional discount', () => {
    const { errors } = validateFiscalContext(
      context({
        invoice: invoice({ discountAmount: '100.00' }),
        legacyTaxes: legacyTaxes({
          iss: { base: '900.00', rate: '3', amount: '27.00' },
          netReceivableAmount: '873.00',
        }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('flags a calculated ISS for the MEI regime', () => {
    const { errors } = validateFiscalContext(
      context({ companyProfile: profile({ taxRegime: 'MEI' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.iss',
        code: 'TAX_CALCULATION_UNSUPPORTED',
      }),
    );
  });

  it('flags RTC taxes for the MEI regime', () => {
    const { errors } = validateFiscalContext(
      context({
        companyProfile: profile({ taxRegime: 'MEI' }),
        legacyTaxes: undefined,
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNSUPPORTED',
      }),
    );
  });

  it('flags a calculated ISS for the Simples Nacional regime', () => {
    const { errors } = validateFiscalContext(
      context({
        companyProfile: profile({
          taxRegime: 'SIMPLES_NACIONAL',
          simpleNational: true,
        }),
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.iss',
        code: 'TAX_CALCULATION_UNSUPPORTED',
      }),
    );
  });

  it('flags RTC taxes for Simples Nacional without the regular IBS/CBS option', () => {
    const { errors } = validateFiscalContext(
      context({
        companyProfile: profile({
          taxRegime: 'SIMPLES_NACIONAL',
          ibsCbsRegularOption: false,
        }),
        legacyTaxes: undefined,
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNSUPPORTED',
      }),
    );
  });

  it('accepts RTC taxes for Simples Nacional with the regular IBS/CBS option', () => {
    const { errors } = validateFiscalContext(
      context({
        invoice: invoice({ competenceDate: '2027-02-01' }),
        companyProfile: profile({
          taxRegime: 'SIMPLES_NACIONAL',
          ibsCbsRegularOption: true,
          ibsCbsRegularFrom: '2027-01-01',
        }),
        applicability: applicability({
          iss: na('Simples Nacional does not charge ISS separately'),
        }),
        legacyTaxes: undefined,
      }),
    );
    expect(errors).toEqual([]);
  });

  it('flags RTC taxes for Simples Nacional when the regular IBS/CBS option is not yet effective', () => {
    const { errors } = validateFiscalContext(
      context({
        invoice: invoice({ competenceDate: '2026-12-10' }),
        companyProfile: profile({
          taxRegime: 'SIMPLES_NACIONAL',
          ibsCbsRegularOption: true,
          ibsCbsRegularFrom: '2027-01-01',
        }),
        legacyTaxes: undefined,
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNSUPPORTED',
      }),
    );
  });

  it('flags withholdings greater than the discounted base', () => {
    const { errors } = validateFiscalContext(
      context({
        legacyTaxes: legacyTaxes({
          iss: null,
          withholdings: [
            {
              tax: 'IRRF',
              base: '1000.00',
              rate: '100.001',
              amount: '1000.01',
            },
          ],
        }),
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'withholdings',
        code: 'WITHHOLDINGS_EXCEED_NET',
      }),
    );
  });

  it('accepts withholdings exactly equal to the discounted base', () => {
    const { errors } = validateFiscalContext(
      context({
        legacyTaxes: legacyTaxes({
          withholdings: [
            { tax: 'IRRF', base: '1000.00', rate: '100', amount: '1000.00' },
          ],
          netReceivableAmount: '0.00',
        }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('flags a monetary value with more than two decimal places', () => {
    const { errors } = validateFiscalContext(
      context({ invoice: invoice({ grossAmount: '1000.123' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'invoice.grossAmount',
        code: 'INVALID_DECIMAL_AMOUNT',
      }),
    );
  });

  it('flags a monetary value that is not a decimal string', () => {
    const { errors } = validateFiscalContext(
      context({ legacyTaxes: legacyTaxes({ netReceivableAmount: 'abc' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.netReceivableAmount',
        code: 'INVALID_DECIMAL_AMOUNT',
      }),
    );
  });

  it('flags an RTC amount with more than two decimal places', () => {
    const { errors } = validateFiscalContext(
      context({
        rtcTaxes: rtcTaxes({
          cbs: { base: '1000.00', rate: '0.9', amount: '9.123' },
        }),
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes.cbs.amount',
        code: 'INVALID_DECIMAL_AMOUNT',
      }),
    );
  });

  it('flags an out-of-range competence date', () => {
    const { errors } = validateFiscalContext(
      context({ invoice: invoice({ competenceDate: '2026-13-10' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'competenceDate',
        code: 'INVALID_COMPETENCE_DATE',
      }),
    );
  });

  it('flags a competence date that does not exist in the calendar', () => {
    const { errors } = validateFiscalContext(
      context({ invoice: invoice({ competenceDate: '2027-02-30' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'competenceDate',
        code: 'INVALID_COMPETENCE_DATE',
      }),
    );
  });

  it('flags a competence date in the wrong format', () => {
    const { errors } = validateFiscalContext(
      context({ invoice: invoice({ competenceDate: '10/12/2026' }) }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: 'competenceDate',
        code: 'INVALID_COMPETENCE_DATE',
      }),
    );
  });

  it('aggregates every blocking error instead of stopping at the first one', () => {
    const { errors } = validateFiscalContext(
      context({
        companyProfile: undefined,
        classification: undefined,
        rtcTaxes: undefined,
      }),
    );
    const fields = errors.map((issue) => issue.field);
    expect(fields).toEqual(
      expect.arrayContaining(['companyProfile', 'classification', 'rtcTaxes']),
    );
    expect(fields).toHaveLength(3);
  });
});
