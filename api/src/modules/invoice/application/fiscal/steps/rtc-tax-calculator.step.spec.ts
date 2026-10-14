import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  Obligation,
  TaxApplicability,
} from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { fiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { toDecimal } from '@/modules/invoice/domain/fiscal/money';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import type { RtcCalculatorPort } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { ok, err, type Result } from '@/modules/invoice/domain/fiscal/result';
import { IBS_CBS_TOLERATED_WARNING_CODE } from '@/modules/invoice/domain/fiscal/validation/fiscal-validator';
import {
  contextFor,
  type ContextForOptions,
} from '../testing/context';
import { FakeRtcCalculator } from '../testing/fake-rtc-calculator';
import { RtcTaxCalculatorStep, assertRtcResultConsistent } from './rtc-tax-calculator.step';

const REQUIRED: Obligation = { status: 'REQUIRED' };
const na = (reason: string): Obligation => ({ status: 'NOT_APPLICABLE', reason });
const unsupported = (reason: string): Obligation => ({ status: 'UNSUPPORTED', reason });

const companyProfile = (
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

const rtcResult = (overrides: Partial<RtcTaxResult> = {}): RtcTaxResult => ({
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

const context = (overrides: ContextForOptions = {}) =>
  contextFor({
    invoice: {
      service: {
        code: '010601',
        municipalityCode: '3550308',
        description: null,
        fiscal: null,
        serviceProfileId: 'sp-1',
      },
    },
    companyProfile: companyProfile(),
    classification: classification(),
    applicability: applicability(),
    ...overrides,
  });

const unconfiguredError = (): FiscalError =>
  fiscalError({
    code: 'TAX_CALCULATION_UNAVAILABLE',
    message: 'RTC calculator is not configured for this environment',
    category: 'CONFIGURATION',
    step: 'RtcCalculator',
    details: { reason: 'adapter_not_configured' },
    retryable: false,
  });

const unconfiguredFake = (): FakeRtcCalculator =>
  new FakeRtcCalculator({ handler: () => err(unconfiguredError()) });

const stepWith = (
  rtc: RtcCalculatorPort,
  mode: 'block' | 'warn' = 'block',
): RtcTaxCalculatorStep => new RtcTaxCalculatorStep(rtc, new TaxTransitionPolicy(), mode);

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (result.ok === false) throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok === true) throw new Error('expected the step to fail');
  return result.error;
};

describe('RtcTaxCalculatorStep', () => {
  it('is an optional step named RtcTaxCalculator', () => {
    const step = stepWith(new FakeRtcCalculator());
    expect(step.name).toBe('RtcTaxCalculator');
    expect(step.required).toBe(false);
  });

  it('skips when CBS and IBS are not applicable, keeping the reason', async () => {
    const calculator = new FakeRtcCalculator();
    const outcome = outcomeOf(
      await stepWith(calculator).execute(
        context({ applicability: applicability({ cbs: na('regime_imei'), ibs: na('regime_imei') }) }),
      ),
    );
    expect(outcome.status).toBe('skipped');
    if (outcome.status !== 'skipped') return;
    expect(outcome.reason).toBe('regime_imei');
    expect(outcome.context.rtcTaxes).toBeUndefined();
    expect(calculator.calls).toHaveLength(0);
  });

  it('skips when IBS/CBS is unsupported, keeping the reason', async () => {
    const calculator = new FakeRtcCalculator();
    const outcome = outcomeOf(
      await stepWith(calculator).execute(
        context({
          applicability: applicability({
            cbs: unsupported('regime_sem_ibscbs'),
            ibs: unsupported('regime_sem_ibscbs'),
          }),
        }),
      ),
    );
    expect(outcome.status).toBe('skipped');
    if (outcome.status !== 'skipped') return;
    expect(outcome.reason).toBe('regime_sem_ibscbs');
    expect(calculator.calls).toHaveLength(0);
  });

  it('calls the calculator with the classification and incidence data', async () => {
    const calculator = new FakeRtcCalculator();
    const outcome = outcomeOf(
      await stepWith(calculator).execute(
        context({
          classification: classification({
            iss: {
              taxation: 'NORMAL',
              rate: '3',
              withholdingDefault: false,
              incidenceMunicipalityCode: '4004004',
            },
          }),
        }),
      ),
    );
    expect(outcome.status).toBe('applied');
    expect(calculator.calls).toEqual([
      {
        competenceDate: '2026-10-13',
        grossAmount: '1000.00',
        discountAmount: '0.00',
        serviceCode: '010601',
        nbsCode: '010601001',
        cst: '000',
        classCode: '060101',
        operationIndicator: '000000',
        providerTaxId: '11222330000181',
        providerMunicipalityCode: '3550308',
        incidenceMunicipalityCode: '4004004',
        customer: { kind: 'CNPJ', taxId: '12345678000199', municipalityCode: '3550308' },
        regime: 'LUCRO_PRESUMIDO',
      },
    ]);
  });

  it('stores the typed RTC result in the context (R$1000: CBS 9.00, IBS 1.00 with the fake)', async () => {
    const outcome = outcomeOf(
      await stepWith(new FakeRtcCalculator()).execute(context()),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.rtcTaxes).toEqual({
      calculatorVersion: 'fake-2026.1',
      cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
      ibsState: { base: '1000.00', rate: '0', amount: '0.00' },
      ibsCity: { base: '1000.00', rate: '0.1', amount: '1.00' },
      ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
      legalReferences: ['LC 214/2025'],
      calculationMemory: [{ source: 'fake-rtc' }],
      collectionWaived: true,
    });
  });

  it('propagates a retryable integration error unchanged', async () => {
    const timeout = fiscalError({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      message: 'RTC engine did not answer in time',
      category: 'INTEGRATION',
      step: 'RtcCalculator',
      details: { reason: 'timeout' },
      retryable: true,
    });
    const result = await stepWith(
      new FakeRtcCalculator({ handler: () => err(timeout) }),
    ).execute(context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(timeout);
    expect(result.error.retryable).toBe(true);
  });

  it('unconfigured adapter blocks in block mode', async () => {
    const error = errorOf(
      await stepWith(unconfiguredFake(), 'block').execute(context()),
    );
    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      category: 'CONFIGURATION',
      retryable: false,
      details: { reason: 'adapter_not_configured' },
    });
  });

  it('unconfigured adapter in warn mode inside the Sefin tolerance window emits a warning and continues', async () => {
    const outcome = outcomeOf(
      await stepWith(unconfiguredFake(), 'warn').execute(
        context({ invoice: { competenceDate: '2026-12-10' } }),
      ),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.rtcTaxes).toBeUndefined();
    expect(outcome.context.warnings).toEqual([
      {
        code: IBS_CBS_TOLERATED_WARNING_CODE,
        message: expect.any(String),
        step: 'RtcTaxCalculator',
      },
    ]);
  });

  it('warn mode does not tolerate after 2026-12-31', async () => {
    const error = errorOf(
      await stepWith(unconfiguredFake(), 'warn').execute(
        context({ invoice: { competenceDate: '2027-01-05' } }),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: false,
      details: { reason: 'adapter_not_configured' },
    });
  });

  it('rejects an inconsistent engine result (IBS parts do not sum to the total)', async () => {
    const inconsistent = rtcResult({
      ibsTotal: { base: '1000.00', rate: '0.12', amount: '1.20' },
    });
    const error = errorOf(
      await stepWith(new FakeRtcCalculator({ handler: () => ok(inconsistent) })).execute(
        context(),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'CALCULATION',
      retryable: false,
      details: { reason: 'rtc_inconsistent_result' },
    });
  });

  it('rejects a negative amount from the engine', async () => {
    const negative = rtcResult({
      cbs: { base: '1000.00', rate: '-0.9', amount: '-9.00' },
    });
    const error = errorOf(
      await stepWith(new FakeRtcCalculator({ handler: () => ok(negative) })).execute(context()),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'CALCULATION',
      retryable: false,
      details: { reason: 'rtc_inconsistent_result' },
    });
  });

  it('does not call the calculator twice for one execution', async () => {
    const calculator = new FakeRtcCalculator();
    const result = await stepWith(calculator).execute(context());
    expect(result.ok).toBe(true);
    expect(calculator.calls).toHaveLength(1);
  });

  it('fails with FISCAL_INTERNAL_ERROR when the applicability is missing', async () => {
    const error = errorOf(
      await stepWith(new FakeRtcCalculator()).execute(
        contextFor({ companyProfile: companyProfile(), classification: classification() }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'applicability_missing' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the classification is missing', async () => {
    const error = errorOf(
      await stepWith(new FakeRtcCalculator()).execute(
        contextFor({ companyProfile: companyProfile(), applicability: applicability() }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'classification_missing' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the company profile is missing', async () => {
    const error = errorOf(
      await stepWith(new FakeRtcCalculator()).execute(
        contextFor({ classification: classification(), applicability: applicability() }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'company_profile_missing' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the classification lacks the RTC codes', async () => {
    const error = errorOf(
      await stepWith(new FakeRtcCalculator()).execute(
        context({ classification: classification({ nbsCode: null }) }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'classification_incomplete', missingFields: ['nbsCode'] },
    });
  });
});

describe('assertRtcResultConsistent', () => {
  const gross = toDecimal('1000.00');

  it('accepts a consistent engine result', () => {
    expect(assertRtcResultConsistent(rtcResult(), gross)).toBeNull();
  });

  it('accepts a consistent result when the IBS components are absent', () => {
    const result = rtcResult({ ibsState: null, ibsCity: null, ibsTotal: null });
    expect(assertRtcResultConsistent(result, gross)).toBeNull();
  });

  it('rejects IBS components that do not sum to the declared total', () => {
    const error = assertRtcResultConsistent(
      rtcResult({ ibsTotal: { base: '1000.00', rate: '0.12', amount: '1.20' } }),
      gross,
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'CALCULATION',
      retryable: false,
      details: { reason: 'rtc_inconsistent_result' },
    });
  });

  it('rejects a negative amount', () => {
    const error = assertRtcResultConsistent(
      rtcResult({ ibsCity: { base: '1000.00', rate: '-0.1', amount: '-1.00' } }),
      gross,
    );
    expect(error?.details.reason).toBe('rtc_inconsistent_result');
  });

  it('rejects a base greater than the gross amount', () => {
    const error = assertRtcResultConsistent(
      rtcResult({ cbs: { base: '1000.01', rate: '0.9', amount: '9.00' } }),
      gross,
    );
    expect(error?.details.reason).toBe('rtc_inconsistent_result');
  });

  it('rejects a non-decimal amount', () => {
    const error = assertRtcResultConsistent(
      rtcResult({ cbs: { base: '1000.00', rate: '0.9', amount: 'nine' } }),
      gross,
    );
    expect(error?.details.reason).toBe('rtc_inconsistent_result');
  });
});
