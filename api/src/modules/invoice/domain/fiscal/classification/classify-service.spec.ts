import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type {
  CompanyServiceTaxProfile,
} from '@/modules/company/domain/service-tax-profile';
import type { ClassificationValidationResult } from './fiscal-catalog.port';
import type { NormalizedInvoice, ServiceFiscalInput } from '../normalized-invoice';
import type { ServiceTaxClassification } from './service-tax-classification';
import {
  CatalogLookup,
  IFiscalCatalog,
} from './fiscal-catalog.port';
import type { FiscalError } from '../fiscal-error';
import type { Result } from '../result';
import { classifyService } from './classify-service';

// SYNTHETIC — format-valid placeholders for pure unit tests only
const SYNTHETIC_NBS = '900000001';
const SYNTHETIC_CST = '900';
const SYNTHETIC_CLASS = '900001';
const SYNTHETIC_INDOP = '900001';

class StubCatalog extends IFiscalCatalog {
  constructor(
    private readonly opts: {
      known: string[];
      validation?: ClassificationValidationResult;
    },
  ) {
    super();
  }
  lookupServiceCode(code: string): CatalogLookup {
    return { version: 'ctribnac-2026.1', found: this.opts.known.includes(code) };
  }
  validateClassification(): ClassificationValidationResult {
    return (
      this.opts.validation ?? { status: 'unavailable', reason: 'catalogs not loaded' }
    );
  }
}

const fakeCatalog = (opts: {
  known: string[];
  validation?: ClassificationValidationResult;
}): IFiscalCatalog => new StubCatalog(opts);

const KNOWN_CODES = ['060101', '010601'];

const invoice = (
  overrides: {
    code?: string;
    fiscal?: ServiceFiscalInput | null;
    serviceProfileId?: string | null;
    environment?: 'test' | 'live';
  } = {},
): NormalizedInvoice => ({
  invoiceId: 'inv-1',
  tenantId: 'ten-1',
  environment: overrides.environment ?? 'test',
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
    code: overrides.code ?? '060101',
    municipalityCode: '3550308',
    description: null,
    fiscal: overrides.fiscal ?? null,
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

const classify = (opts: {
  inv?: NormalizedInvoice;
  profile?: CompanyFiscalProfile;
  serviceProfiles?: CompanyServiceTaxProfile[];
  requestedProfileId?: string | null;
  catalog?: IFiscalCatalog;
}): Result<ServiceTaxClassification, FiscalError> => {
  const inv = opts.inv ?? invoice();
  return classifyService({
    invoice: inv,
    profile: opts.profile ?? companyProfile(),
    serviceProfiles: opts.serviceProfiles ?? [],
    requestedProfileId:
      opts.requestedProfileId !== undefined
        ? opts.requestedProfileId
        : inv.service.serviceProfileId,
    catalog: opts.catalog ?? fakeCatalog({ known: KNOWN_CODES }),
  });
};

const valueOf = (result: Result<ServiceTaxClassification, FiscalError>): ServiceTaxClassification => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
};

const errorOf = (result: Result<ServiceTaxClassification, FiscalError>): FiscalError => {
  if (result.ok) throw new Error('expected a classification failure, got a classification');
  return result.error;
};

describe('classifyService', () => {
  it('rejects a service code absent from the official catalog', () => {
    const error = errorOf(classify({ inv: invoice({ code: '999999' }) }));
    expect(error).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      category: 'CLASSIFICATION',
      details: { field: 'service.code' },
    });
  });

  it('explicit override wins and is flagged request_override', () => {
    const classification = valueOf(
      classify({
        inv: invoice({
          fiscal: {
            nbsCode: SYNTHETIC_NBS,
            cst: SYNTHETIC_CST,
            classCode: SYNTHETIC_CLASS,
            operationIndicator: SYNTHETIC_INDOP,
          },
        }),
        serviceProfiles: [
          serviceProfile({
            nbsCode: '111111111',
            cst: '001',
            classCode: '111111',
            operationIndicator: '111111',
          }),
        ],
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: { status: 'validated', versions: { nbs: '2026.1' } },
        }),
      }),
    );
    expect(classification).toMatchObject({
      serviceCode: '060101',
      source: 'request_override',
      nbsCode: SYNTHETIC_NBS,
      cst: SYNTHETIC_CST,
      classCode: SYNTHETIC_CLASS,
      operationIndicator: SYNTHETIC_INDOP,
      catalogValidated: true,
      catalogVersions: { nbs: '2026.1' },
      justification: 'explicit request override',
    });
  });

  it('override merges only missing fields from the approved company profile', () => {
    const merged = valueOf(
      classify({
        inv: invoice({ fiscal: { nbsCode: SYNTHETIC_NBS } }),
        serviceProfiles: [serviceProfile()],
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: { status: 'validated', versions: { nbs: '2026.1' } },
        }),
      }),
    );
    expect(merged).toMatchObject({
      source: 'request_override',
      serviceProfileId: 'sp-1',
      nbsCode: SYNTHETIC_NBS,
      cst: SYNTHETIC_CST,
      classCode: SYNTHETIC_CLASS,
      operationIndicator: SYNTHETIC_INDOP,
      municipalServiceCode: '0001',
      justification: 'explicit request override',
      iss: {
        taxation: 'NORMAL',
        rate: '5',
        withholdingDefault: false,
        incidenceMunicipalityCode: '3550308',
      },
      withholding: { policy: 'CONFIGURED', rates: { irrf: '1.5' } },
    });

    const unapproved = valueOf(
      classify({
        inv: invoice({ fiscal: { nbsCode: SYNTHETIC_NBS } }),
        serviceProfiles: [serviceProfile({ reviewStatus: 'unreviewed' })],
      }),
    );
    expect(unapproved).toMatchObject({
      source: 'request_override',
      nbsCode: SYNTHETIC_NBS,
      cst: null,
      classCode: null,
      operationIndicator: null,
      municipalServiceCode: null,
      serviceProfileId: null,
    });
  });

  it('company profile classification is used when no override is sent', () => {
    const classification = valueOf(
      classify({
        serviceProfiles: [serviceProfile()],
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: { status: 'validated', versions: { nbs: '2026.1' } },
        }),
      }),
    );
    expect(classification).toMatchObject({
      source: 'company_service_profile',
      serviceProfileId: 'sp-1',
      nbsCode: SYNTHETIC_NBS,
      cst: SYNTHETIC_CST,
      classCode: SYNTHETIC_CLASS,
      operationIndicator: SYNTHETIC_INDOP,
      municipalServiceCode: '0001',
      operationNature: 'SERVICE',
      iss: {
        taxation: 'NORMAL',
        rate: '5',
        withholdingDefault: false,
        incidenceMunicipalityCode: '3550308',
      },
      withholding: { policy: 'CONFIGURED', rates: { irrf: '1.5' } },
      catalogValidated: true,
      catalogVersions: { nbs: '2026.1' },
    });
  });

  it('requested serviceProfileId must belong to the company and be effective on the competence date', () => {
    const notFound = errorOf(
      classify({ serviceProfiles: [], requestedProfileId: 'sp-1' }),
    );
    expect(notFound).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      category: 'CLASSIFICATION',
      details: { serviceProfileId: 'sp-1' },
    });

    const otherCompany = errorOf(
      classify({
        serviceProfiles: [serviceProfile({ companyId: 'comp-other' })],
        requestedProfileId: 'sp-1',
      }),
    );
    expect(otherCompany).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      details: { serviceProfileId: 'sp-1' },
    });

    const expired = errorOf(
      classify({
        serviceProfiles: [serviceProfile({ effectiveUntil: '2026-06-01' })],
        requestedProfileId: 'sp-1',
      }),
    );
    expect(expired).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      details: { serviceProfileId: 'sp-1' },
    });
  });

  it('two effective profiles for the same code are ambiguous (never picks the first)', () => {
    const error = errorOf(
      classify({
        serviceProfiles: [serviceProfile(), serviceProfile({ id: 'sp-2' })],
      }),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_AMBIGUOUS',
      category: 'CLASSIFICATION',
      details: { candidates: ['sp-1', 'sp-2'] },
    });
  });

  it('profile whose regimeApplicability excludes the regime is not used', () => {
    const excludedByCode = valueOf(
      classify({
        serviceProfiles: [
          serviceProfile({ regimeApplicability: ['LUCRO_REAL'] }),
        ],
      }),
    );
    expect(excludedByCode).toMatchObject({
      source: 'official_catalog',
      serviceProfileId: null,
      nbsCode: null,
      cst: null,
      classCode: null,
      operationIndicator: null,
    });

    const excludedById = errorOf(
      classify({
        serviceProfiles: [
          serviceProfile({ regimeApplicability: ['LUCRO_REAL'] }),
        ],
        requestedProfileId: 'sp-1',
      }),
    );
    expect(excludedById).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      details: { serviceProfileId: 'sp-1' },
    });
  });

  it('falls back to a partial official-catalog classification', () => {
    const classification = valueOf(classify({ serviceProfiles: [] }));
    expect(classification).toEqual({
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
        taxation: null,
        rate: null,
        withholdingDefault: false,
        incidenceMunicipalityCode: null,
      },
      withholding: { policy: 'UNKNOWN', rates: {} },
      catalogVersions: {},
      catalogValidated: false,
      justification:
        'service code found in official catalog; no company classification configured',
    });
  });

  it('catalog-invalid override fails with the catalog issues', () => {
    const invalid = errorOf(
      classify({
        inv: invoice({
          fiscal: {
            nbsCode: SYNTHETIC_NBS,
            cst: SYNTHETIC_CST,
            classCode: SYNTHETIC_CLASS,
            operationIndicator: SYNTHETIC_INDOP,
          },
        }),
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: {
            status: 'invalid',
            issues: [
              { field: 'service.fiscal.cst', reason: 'cst conflicts with classCode' },
            ],
          },
        }),
      }),
    );
    expect(invalid).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      category: 'CLASSIFICATION',
      details: {
        issues: [{ field: 'service.fiscal.cst', reason: 'cst conflicts with classCode' }],
      },
    });

    const ambiguous = errorOf(
      classify({
        inv: invoice({
          fiscal: { nbsCode: SYNTHETIC_NBS, cst: SYNTHETIC_CST },
        }),
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: {
            status: 'ambiguous',
            candidates: [{ nbsCode: SYNTHETIC_NBS }, { nbsCode: '888888888' }],
          },
        }),
      }),
    );
    expect(ambiguous).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_AMBIGUOUS',
      details: {
        candidates: [{ nbsCode: SYNTHETIC_NBS }, { nbsCode: '888888888' }],
      },
    });

    const unavailable = valueOf(
      classify({
        inv: invoice({
          fiscal: { nbsCode: SYNTHETIC_NBS, cst: SYNTHETIC_CST },
        }),
        catalog: fakeCatalog({
          known: KNOWN_CODES,
          validation: { status: 'unavailable', reason: 'catalogs not loaded' },
        }),
      }),
    );
    expect(unavailable).toMatchObject({
      source: 'request_override',
      catalogValidated: false,
      nbsCode: SYNTHETIC_NBS,
      cst: SYNTHETIC_CST,
    });
  });

  it('live + unreviewed service profile requires review', () => {
    const unreviewedInLive = errorOf(
      classify({
        inv: invoice({ environment: 'live' }),
        serviceProfiles: [serviceProfile({ reviewStatus: 'unreviewed' })],
      }),
    );
    expect(unreviewedInLive).toMatchObject({
      code: 'FISCAL_REVIEW_REQUIRED',
      category: 'CONFIGURATION',
      details: { serviceProfileId: 'sp-1', reviewStatus: 'unreviewed' },
    });

    const rejected = errorOf(
      classify({
        inv: invoice({ environment: 'test' }),
        serviceProfiles: [serviceProfile({ reviewStatus: 'rejected' })],
      }),
    );
    expect(rejected).toMatchObject({
      code: 'FISCAL_REVIEW_REQUIRED',
      details: { serviceProfileId: 'sp-1', reviewStatus: 'rejected' },
    });
  });

  it('carries ISS settings and withholding policy from the profile', () => {
    const classification = valueOf(
      classify({
        serviceProfiles: [
          serviceProfile({
            issTaxation: 'EXEMPT',
            issRate: null,
            issWithholdingDefault: true,
            incidenceMunicipalityCode: '3304557',
            withholdingPolicy: 'NONE_CONFIRMED',
            withholdingRates: { inss: '11' },
          }),
        ],
      }),
    );
    expect(classification.iss).toEqual({
      taxation: 'EXEMPT',
      rate: null,
      withholdingDefault: true,
      incidenceMunicipalityCode: '3304557',
    });
    expect(classification.withholding).toEqual({
      policy: 'NONE_CONFIRMED',
      rates: { inss: '11' },
    });
  });

  it('carries operationNature from the profile (GOODS)', () => {
    const classification = valueOf(
      classify({
        serviceProfiles: [serviceProfile({ operationNature: 'GOODS' })],
      }),
    );
    expect(classification).toMatchObject({
      source: 'company_service_profile',
      operationNature: 'GOODS',
    });
  });
});
