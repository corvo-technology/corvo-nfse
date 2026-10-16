import type {
  TaxApplicability,
  Obligation,
} from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import type { WithholdingRates } from '@/modules/company/domain/service-tax-profile';
import { LegacyTaxCalculatorStep } from './legacy-tax-calculator.step';

const REQUIRED: Obligation = { status: 'REQUIRED' };
const na = (reason: string): Obligation => ({
  status: 'NOT_APPLICABLE',
  reason,
});

const invoice = (
  grossAmount: string,
  discountAmount: string,
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
  competenceDate: '2026-10-13',
  grossAmount,
  discountAmount,
  service: {
    code: '010101',
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
});

const applicability = (
  overrides: Partial<
    Pick<TaxApplicability, 'iss' | 'issWithheld' | 'federalWithholding'>
  > = {},
): TaxApplicability => ({
  strategy: 'regime_specific',
  customerRequired: true,
  iss: na('regime_imei'),
  issWithheld: na('regime_imei'),
  federalWithholding: na('regime_imei'),
  cbs: na('regime_imei'),
  ibs: na('regime_imei'),
  specialTreatment: na('sem_tratamento_especial'),
  collectionWaived: true,
  rulesVersion: 'rtc-2026',
  legalReferences: ['LC 116/2003'],
  ...overrides,
});

const classification = (
  overrides: { issRate?: string | null; rates?: WithholdingRates } = {},
): ServiceTaxClassification => ({
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: '010101001',
  cst: '000',
  classCode: '060101',
  operationIndicator: '000000',
  source: 'company_service_profile',
  serviceProfileId: 'sp-1',
  operationNature: 'SERVICE',
  iss: {
    taxation: 'NORMAL',
    rate: overrides.issRate === undefined ? '5' : overrides.issRate,
    withholdingDefault: false,
    incidenceMunicipalityCode: '3550308',
  },
  withholding: { policy: 'CONFIGURED', rates: overrides.rates ?? {} },
  catalogVersions: { nbs: '2026.1' },
  catalogValidated: true,
  justification: 'perfil do servico',
});

const context = (
  grossAmount = '1000.00',
  discountAmount = '0.00',
  app: TaxApplicability | null = applicability(),
  cls: ServiceTaxClassification | null = classification(),
): FiscalContext => ({
  ...initialFiscalContext(invoice(grossAmount, discountAmount)),
  ...(app ? { applicability: app } : {}),
  ...(cls ? { classification: cls } : {}),
});

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (result.ok === false)
    throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok === true) throw new Error('expected the step to fail');
  return result.error;
};

describe('LegacyTaxCalculatorStep', () => {
  const step = new LegacyTaxCalculatorStep();

  it('is an optional step named LegacyTaxCalculator', () => {
    expect(step.name).toBe('LegacyTaxCalculator');
    expect(step.required).toBe(false);
  });

  it('skips when nothing is applicable (MEI), keeping the reason', async () => {
    const outcome = outcomeOf(await step.execute(context()));
    expect(outcome.status).toBe('skipped');
    if (outcome.status !== 'skipped') return;
    expect(outcome.reason).toBe('regime_imei');
    expect(outcome.context.legacyTaxes).toBeUndefined();
  });

  it('computes the withheld ISS and the net receivable amount', async () => {
    const outcome = outcomeOf(
      await step.execute(
        context(
          '1000.00',
          '100.00',
          applicability({ iss: REQUIRED, issWithheld: REQUIRED }),
        ),
      ),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.legacyTaxes).toEqual({
      iss: { base: '900.00', rate: '5', amount: '45.00' },
      issWithheld: true,
      issResponsible: 'CUSTOMER',
      withholdings: [
        { tax: 'ISS', base: '900.00', rate: '5', amount: '45.00' },
      ],
      netReceivableAmount: '855.00',
    });
  });

  it('computes federal withholdings on the discounted base and keeps the ISS for the provider', async () => {
    const outcome = outcomeOf(
      await step.execute(
        context(
          '1000.00',
          '100.00',
          applicability({ iss: REQUIRED, federalWithholding: REQUIRED }),
          classification({ rates: { irrf: '1.5' } }),
        ),
      ),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.legacyTaxes).toEqual({
      iss: { base: '900.00', rate: '5', amount: '45.00' },
      issWithheld: false,
      issResponsible: 'PROVIDER',
      withholdings: [
        { tax: 'IRRF', base: '900.00', rate: '1.5', amount: '13.50' },
      ],
      netReceivableAmount: '886.50',
    });
  });

  it('registers a warning when the unconditional discount is deducted from the ISS base', async () => {
    const outcome = outcomeOf(
      await step.execute(
        context('1000.00', '100.00', applicability({ iss: REQUIRED })),
      ),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.warnings).toEqual([
      {
        code: 'UNCONDITIONAL_DISCOUNT_DEDUCTED',
        message:
          'Desconto incondicional deduzido da base de cálculo do ISS (LC 116/2003, art. 7º)',
        step: 'LegacyTaxCalculator',
      },
    ]);
  });

  it('rejects a discount greater than the gross amount', async () => {
    const error = errorOf(
      await step.execute(
        context('1000.00', '1000.01', applicability({ iss: REQUIRED })),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'VALIDATION',
      retryable: false,
      details: { fields: ['discount'] },
    });
  });

  it('rejects a negative net receivable', async () => {
    const error = errorOf(
      await step.execute(
        context(
          '100.00',
          '0.00',
          applicability({ federalWithholding: REQUIRED }),
          classification({ rates: { irrf: '150' } }),
        ),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'VALIDATION',
      details: { reason: 'negative_net_receivable' },
    });
  });

  it('fails with TAX_RATE_NOT_FOUND when ISS is required without a rate (defense in depth)', async () => {
    const error = errorOf(
      await step.execute(
        context(
          '1000.00',
          '0.00',
          applicability({ iss: REQUIRED }),
          classification({ issRate: null }),
        ),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_RATE_NOT_FOUND',
      category: 'CONFIGURATION',
      details: { tax: 'ISS' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the applicability is missing', async () => {
    const error = errorOf(await step.execute(context('1000.00', '0.00', null)));
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'applicability_missing' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the classification is missing', async () => {
    const error = errorOf(
      await step.execute(
        context('1000.00', '0.00', applicability({ iss: REQUIRED }), null),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'classification_missing' },
    });
  });
});
