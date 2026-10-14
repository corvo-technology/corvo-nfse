import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  CompanyServiceTaxProfile,
} from '@/modules/company/domain/service-tax-profile';
import type { ClassificationValidationResult } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import type { CatalogLookup } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import { IFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import { IServiceProfileReader } from '@/modules/invoice/domain/fiscal/ports/service-profile.reader';
import { ServiceTaxClassifierStep } from './service-tax-classifier.step';

class StubCatalog extends IFiscalCatalog {
  validation: ClassificationValidationResult = {
    status: 'unavailable',
    reason: 'catalogs not loaded',
  };
  lookupServiceCode(code: string): CatalogLookup {
    return { version: 'ctribnac-2026.1', found: ['060101', '010601'].includes(code) };
  }
  validateClassification(): ClassificationValidationResult {
    return this.validation;
  }
}

const invoice = (
  overrides: { serviceProfileId?: string | null } = {},
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
  grossAmount: '1000.00',
  discountAmount: '0.00',
  service: {
    code: '060101',
    municipalityCode: '3550308',
    description: null,
    fiscal: null,
    serviceProfileId: overrides.serviceProfileId ?? null,
  },
  customer: null,
});

const companyProfile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'cfp-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'manual',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

// SYNTHETIC — format-valid placeholders for pure unit tests only
const SYNTHETIC_NBS = '900000001';
const SYNTHETIC_CST = '900';
const SYNTHETIC_CLASS = '900001';
const SYNTHETIC_INDOP = '900001';

const serviceProfile = (
  overrides: Partial<CompanyServiceTaxProfile> = {},
): CompanyServiceTaxProfile => ({
  id: 'sp-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  name: 'Limpeza predial',
  serviceCode: '060101',
  municipalServiceCode: '0001',
  nbsCode: SYNTHETIC_NBS,
  cst: SYNTHETIC_CST,
  classCode: SYNTHETIC_CLASS,
  operationIndicator: SYNTHETIC_INDOP,
  operationNature: 'SERVICE',
  regimeApplicability: [],
  incidenceMunicipalityCode: '3550308',
  issTaxation: 'NORMAL',
  issRate: '5',
  issWithholdingDefault: false,
  withholdingPolicy: 'CONFIGURED',
  withholdingRates: { irrf: '1.5' },
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'approved',
  catalogVersion: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const contextFor = (
  inv: NormalizedInvoice,
  profile: CompanyFiscalProfile | null,
): FiscalContext => ({
  ...initialFiscalContext(inv),
  ...(profile === null ? {} : { companyProfile: profile }),
});

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (!result.ok) throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok) throw new Error('expected the step to fail');
  return result.error;
};

const fakeReader = () => {
  const findById = jest.fn(
    async (_id: string, _companyId: string, _tenantId: string): Promise<CompanyServiceTaxProfile | null> => null,
  );
  const findEffectiveByCode = jest.fn(
    async (_companyId: string, _tenantId: string, _serviceCode: string, _date: string): Promise<CompanyServiceTaxProfile[]> => [],
  );
  const reader: IServiceProfileReader = { findById, findEffectiveByCode };
  return { reader, findById, findEffectiveByCode };
};

describe('ServiceTaxClassifierStep', () => {
  it('is a required step named ServiceTaxClassifier', () => {
    const step = new ServiceTaxClassifierStep(fakeReader().reader, new StubCatalog());
    expect(step.name).toBe('ServiceTaxClassifier');
    expect(step.required).toBe(true);
  });

  it('fails with FISCAL_INTERNAL_ERROR when the company profile is missing', async () => {
    const step = new ServiceTaxClassifierStep(fakeReader().reader, new StubCatalog());
    const error = errorOf(await step.execute(contextFor(invoice(), null)));
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      step: 'ServiceTaxClassifier',
    });
  });

  it('updates the context classification and warns when catalog validation was not performed', async () => {
    const { reader } = fakeReader();
    const step = new ServiceTaxClassifierStep(reader, new StubCatalog());
    const context = contextFor(invoice(), companyProfile());
    const outcome = outcomeOf(await step.execute(context));
    expect(outcome.status).toBe('applied');
    expect(outcome.context.classification).toMatchObject({
      source: 'official_catalog',
      serviceCode: '060101',
      catalogValidated: false,
    });
    expect(outcome.context.warnings).toContainEqual(
      expect.objectContaining({
        code: 'CLASSIFICATION_NOT_CATALOG_VALIDATED',
        step: 'ServiceTaxClassifier',
      }),
    );
  });

  it('uses the company service profile without warning when catalog validation succeeds', async () => {
    const { reader, findEffectiveByCode } = fakeReader();
    findEffectiveByCode.mockResolvedValue([serviceProfile()]);
    const catalog = new StubCatalog();
    catalog.validation = { status: 'validated', versions: { nbs: '2026.1' } };
    const step = new ServiceTaxClassifierStep(reader, catalog);
    const outcome = outcomeOf(await step.execute(contextFor(invoice(), companyProfile())));
    expect(outcome.context.classification).toMatchObject({
      source: 'company_service_profile',
      serviceProfileId: 'sp-1',
      catalogValidated: true,
      catalogVersions: { nbs: '2026.1' },
    });
    expect(outcome.context.warnings).toEqual([]);
  });

  it('loads the service profile by id when one was requested, by effective code otherwise', async () => {
    const { reader, findById, findEffectiveByCode } = fakeReader();
    const step = new ServiceTaxClassifierStep(reader, new StubCatalog());
    await step.execute(contextFor(invoice({ serviceProfileId: 'sp-9' }), companyProfile()));
    expect(findById).toHaveBeenCalledWith('sp-9', 'comp-1', 'ten-1');
    expect(findEffectiveByCode).not.toHaveBeenCalled();

    await step.execute(contextFor(invoice(), companyProfile()));
    expect(findEffectiveByCode).toHaveBeenCalledWith('comp-1', 'ten-1', '060101', '2026-10-13');
  });
});
