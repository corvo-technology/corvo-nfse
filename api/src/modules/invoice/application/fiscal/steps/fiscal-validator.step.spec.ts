import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  Obligation,
  TaxApplicability,
} from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { LegacyTaxResult } from '@/modules/invoice/domain/fiscal/legacy/legacy-tax-result';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { FiscalValidatorStep } from './fiscal-validator.step';

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

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (result.ok === false)
    throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok === true) throw new Error('expected the step to fail');
  return result.error;
};

describe('FiscalValidatorStep', () => {
  const step = new FiscalValidatorStep();

  it('is a required step named FiscalValidator', () => {
    expect(step.name).toBe('FiscalValidator');
    expect(step.required).toBe(true);
  });

  it('applies a valid context without altering it', async () => {
    const ctx = context();
    const outcome = outcomeOf(await step.execute(ctx));
    expect(outcome.status).toBe('applied');
    expect(outcome.context).toBe(ctx);
    expect(outcome.context.warnings).toEqual([]);
  });

  it('fails with FISCAL_VALIDATION_FAILED carrying the field issues', async () => {
    const error = errorOf(
      await step.execute(
        context({
          legacyTaxes: legacyTaxes({
            iss: { base: '999.00', rate: '3', amount: '29.97' },
          }),
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'VALIDATION',
      retryable: false,
      step: 'FiscalValidator',
    });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({
        field: 'legacyTaxes.iss.base',
        code: 'ISS_BASE_MISMATCH',
      }),
    );
  });

  it('fails when the required IBS/CBS calculation is missing', async () => {
    const error = errorOf(
      await step.execute(
        context({
          rtcTaxes: undefined,
        }),
      ),
    );
    expect(error).toMatchObject({ code: 'FISCAL_VALIDATION_FAILED' });
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNAVAILABLE',
      }),
    );
  });

  it('accepts the context untouched when the Sefin tolerance warning covers the missing IBS/CBS', async () => {
    const outcome = outcomeOf(
      await step.execute(
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
      ),
    );
    expect(outcome.status).toBe('applied');
  });

  it('aggregates the issues of a bare initial context', async () => {
    const error = errorOf(await step.execute(initialFiscalContext(invoice())));
    expect(error).toMatchObject({ code: 'FISCAL_VALIDATION_FAILED' });
    const fields = error.details.issues;
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'companyProfile' }),
        expect.objectContaining({ field: 'classification' }),
        expect.objectContaining({ field: 'applicability' }),
      ]),
    );
  });
});
