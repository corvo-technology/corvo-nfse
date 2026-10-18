import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { MeiTaxStrategy } from '../strategies/mei-tax.strategy';
import { RegularTaxStrategy } from '../strategies/regular-tax.strategy';
import { SimplesNacionalTaxStrategy } from '../strategies/simples-nacional-tax.strategy';
import { TaxStrategyResolver } from '../strategies/tax-strategy.resolver';
import { contextFor } from '../testing/context';
import { TaxApplicabilityStep } from './tax-applicability.step';

const profile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'pf-1',
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
  source: 'onboarding',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const classification = (
  overrides: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: 'SYNTHETIC_NBS',
  cst: 'SYNTHETIC_CST',
  classCode: 'SYNTHETIC_CLASS',
  operationIndicator: '03',
  source: 'company_service_profile',
  serviceProfileId: null,
  operationNature: 'SERVICE',
  iss: {
    taxation: 'NORMAL',
    rate: '5.00',
    withholdingDefault: false,
    incidenceMunicipalityCode: '3550308',
  },
  withholding: { policy: 'NONE_CONFIRMED', rates: {} },
  catalogVersions: {},
  catalogValidated: true,
  justification: 'test fixture',
  ...overrides,
});

const stepOf = (): TaxApplicabilityStep =>
  new TaxApplicabilityStep(
    new TaxStrategyResolver([
      new MeiTaxStrategy(),
      new SimplesNacionalTaxStrategy(),
      new RegularTaxStrategy(),
    ]),
    new TaxTransitionPolicy(),
  );

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (result.ok === false)
    throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok === true) throw new Error('expected the step to fail');
  return result.error;
};

describe('TaxApplicabilityStep', () => {
  it('is a required step named TaxApplicabilityResolver', () => {
    expect(stepOf().name).toBe('TaxApplicabilityResolver');
    expect(stepOf().required).toBe(true);
  });

  it('plans a MEI 2026 invoice without a customer and fills context.applicability', async () => {
    const step = stepOf();
    const outcome = outcomeOf(
      await step.execute(
        contextFor({
          companyProfile: profile({ taxRegime: 'MEI' }),
          classification: classification(),
          invoice: { customer: null },
        }),
      ),
    );
    expect(outcome.status).toBe('applied');
    const applicability = outcome.context.applicability;
    if (applicability === undefined)
      throw new Error('expected context.applicability to be filled');
    expect(applicability.strategy).toBe('mei');
    expect(applicability.iss.status).toBe('NOT_APPLICABLE');
    expect(applicability.cbs.status).toBe('NOT_APPLICABLE');
    expect(applicability.ibs.status).toBe('NOT_APPLICABLE');
  });

  it('rejects a regular regime without a customer with FISCAL_VALIDATION_FAILED', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification(),
          invoice: { customer: null, competenceDate: '2026-09-01' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      category: 'VALIDATION',
      step: 'TaxApplicabilityResolver',
      details: { fields: ['customer'] },
    });
  });

  it('blocks MEI in 2027 with TAX_CALCULATION_UNSUPPORTED, never NOT_APPLICABLE', async () => {
    const step = stepOf();
    const result = await step.execute(
      contextFor({
        companyProfile: profile({ taxRegime: 'MEI' }),
        classification: classification(),
        invoice: { competenceDate: '2027-02-10' },
      }),
    );
    const error = errorOf(result);
    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNSUPPORTED',
      category: 'UNSUPPORTED',
      step: 'TaxApplicabilityResolver',
    });
    expect(error.details.tax).toBe('cbs');
    expect(error.details.reason).toEqual(expect.any(String));
    // UNSUPPORTED never degrades into an applied NOT_APPLICABLE obligation.
    expect(result.ok).toBe(false);
  });

  it('reports only the missing IBS/CBS classification fields for a regular regime', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({ nbsCode: null }),
          invoice: { competenceDate: '2026-10-13' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_REQUIRED',
      category: 'CLASSIFICATION',
      step: 'TaxApplicabilityResolver',
    });
    expect(error.details.missingFields).toEqual(['service.fiscal.nbsCode']);
  });

  it('reports FISCAL_CLASSIFICATION_INVALID when the catalog was not validated', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({ catalogValidated: false }),
          invoice: { competenceDate: '2026-10-13' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      category: 'CLASSIFICATION',
      step: 'TaxApplicabilityResolver',
      details: { reason: 'catalog_validation_unavailable' },
    });
  });

  it('fails with TAX_RATE_NOT_FOUND when the ISS rate is missing', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({
            iss: {
              taxation: 'NORMAL',
              rate: null,
              withholdingDefault: false,
              incidenceMunicipalityCode: null,
            },
          }),
          invoice: { competenceDate: '2026-09-01' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_RATE_NOT_FOUND',
      category: 'CONFIGURATION',
      step: 'TaxApplicabilityResolver',
      details: { missingFields: ['service.iss.rate'] },
    });
  });

  it('fails with TAX_RATE_NOT_FOUND when Simples Nacional ISS withholding is required without simplesIssRate', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile({
            taxRegime: 'SIMPLES_NACIONAL',
            simplesIssRate: null,
          }),
          classification: classification({
            iss: {
              taxation: 'NORMAL',
              rate: '5.00',
              withholdingDefault: true,
              incidenceMunicipalityCode: '3550308',
            },
          }),
          invoice: { competenceDate: '2026-09-01' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_RATE_NOT_FOUND',
      category: 'CONFIGURATION',
      step: 'TaxApplicabilityResolver',
      details: { missingFields: ['fiscalProfile.simplesIssRate'] },
    });
  });

  it('fails with TAX_APPLICABILITY_UNKNOWN when the withholding policy is UNKNOWN for a CNPJ customer', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({
            withholding: { policy: 'UNKNOWN', rates: {} },
          }),
          invoice: { competenceDate: '2026-09-01' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_APPLICABILITY_UNKNOWN',
      category: 'CONFIGURATION',
      step: 'TaxApplicabilityResolver',
      details: { missingFields: ['service.withholdingPolicy'] },
    });
  });

  it('propagates OPERATION_DOCUMENT_UNSUPPORTED from the strategy for GOODS', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({ operationNature: 'GOODS' }),
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'OPERATION_DOCUMENT_UNSUPPORTED',
      category: 'UNSUPPORTED',
      step: 'TaxApplicabilityResolver',
    });
  });

  it('maps a PARTNER_SALON operation to FISCAL_REVIEW_REQUIRED', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification({ operationNature: 'PARTNER_SALON' }),
          invoice: { competenceDate: '2026-09-01' },
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_REVIEW_REQUIRED',
      step: 'TaxApplicabilityResolver',
      details: { tax: 'specialTreatment' },
    });
  });

  it('propagates TAX_REGIME_UNSUPPORTED when no strategy matches the regime', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(
        contextFor({
          companyProfile: profile({ taxRegime: 'UNKNOWN' }),
          classification: classification(),
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'TAX_REGIME_UNSUPPORTED',
      category: 'UNSUPPORTED',
      step: 'TaxApplicabilityResolver',
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the company profile precondition is missing', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(contextFor({ classification: classification() })),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      step: 'TaxApplicabilityResolver',
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the classification precondition is missing', async () => {
    const step = stepOf();
    const error = errorOf(
      await step.execute(contextFor({ companyProfile: profile() })),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      step: 'TaxApplicabilityResolver',
    });
  });

  it('attaches rulesVersion and the legal references of the rules consulted', async () => {
    const step = stepOf();
    const outcome = outcomeOf(
      await step.execute(
        contextFor({
          companyProfile: profile({ taxRegime: 'SIMPLES_NACIONAL' }),
          classification: classification(),
          invoice: { competenceDate: '2026-10-13' },
        }),
      ),
    );
    const applicability = outcome.context.applicability;
    if (applicability === undefined)
      throw new Error('expected context.applicability to be filled');
    expect(applicability.strategy).toBe('simples-nacional');
    expect(applicability.rulesVersion).toBe(
      new TaxTransitionPolicy().rulesVersion,
    );
    expect(applicability.legalReferences).toEqual(
      expect.arrayContaining([
        'LC 214/2025 (fase de teste 2026)',
        'Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026',
        'LC 214/2025 e LC 227/2026 (Simples Nacional)',
      ]),
    );
  });

  it('omits the test-phase reference when the competence date falls outside it', async () => {
    const step = stepOf();
    const outcome = outcomeOf(
      await step.execute(
        contextFor({
          companyProfile: profile(),
          classification: classification(),
          invoice: { competenceDate: '2027-02-10' },
        }),
      ),
    );
    const applicability = outcome.context.applicability;
    if (applicability === undefined)
      throw new Error('expected context.applicability to be filled');
    expect(applicability.legalReferences).not.toContain(
      'LC 214/2025 (fase de teste 2026)',
    );
    expect(applicability.legalReferences).toContain(
      'Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026',
    );
  });
});
