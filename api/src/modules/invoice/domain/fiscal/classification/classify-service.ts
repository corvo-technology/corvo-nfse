import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';
import type {
  NormalizedInvoice,
  ServiceFiscalInput,
} from '../normalized-invoice';
import { fiscalError, type FiscalError } from '../fiscal-error';
import { err, ok, type Result } from '../result';
import type { IFiscalCatalog } from './fiscal-catalog.port';
import type { ServiceTaxClassification } from './service-tax-classification';

const CLASSIFICATION_JUSTIFICATION_OVERRIDE = 'explicit request override';
const CLASSIFICATION_JUSTIFICATION_PROFILE_PREFIX = 'company service profile: ';
const CLASSIFICATION_JUSTIFICATION_FALLBACK =
  'service code found in official catalog; no company classification configured';

const present = (value: string | undefined): string | null =>
  value !== undefined && value.trim() !== '' ? value : null;

const overrideField = (
  fiscal: ServiceFiscalInput | null,
  field: keyof ServiceFiscalInput,
): string | null => (fiscal === null ? null : present(fiscal[field]));

const hasOverride = (fiscal: ServiceFiscalInput | null): boolean =>
  fiscal !== null &&
  (present(fiscal.nbsCode) !== null ||
    present(fiscal.cst) !== null ||
    present(fiscal.classCode) !== null ||
    present(fiscal.operationIndicator) !== null);

const effectiveOn = (
  profile: CompanyServiceTaxProfile,
  date: string,
): boolean =>
  profile.effectiveFrom <= date &&
  (profile.effectiveUntil === null || date < profile.effectiveUntil);

const regimeMatches = (
  profile: CompanyServiceTaxProfile,
  regime: CompanyFiscalProfile['taxRegime'],
): boolean =>
  profile.regimeApplicability.length === 0 ||
  profile.regimeApplicability.includes(regime);

const belongsToInvoice = (
  profile: CompanyServiceTaxProfile,
  invoice: NormalizedInvoice,
): boolean =>
  profile.companyId === invoice.company.id &&
  profile.tenantId === invoice.tenantId;

const reviewError = (
  profile: CompanyServiceTaxProfile,
  environment: NormalizedInvoice['environment'],
): FiscalError | null => {
  if (
    profile.reviewStatus === 'rejected' ||
    (environment === 'live' && profile.reviewStatus !== 'approved')
  ) {
    return fiscalError({
      code: 'FISCAL_REVIEW_REQUIRED',
      message: 'Service tax profile requires approval before live emission',
      category: 'CONFIGURATION',
      details: {
        serviceProfileId: profile.id,
        reviewStatus: profile.reviewStatus,
      },
    });
  }
  return null;
};

const classificationFromProfile = (
  invoice: NormalizedInvoice,
  profile: CompanyServiceTaxProfile,
): ServiceTaxClassification => ({
  serviceCode: invoice.service.code,
  municipalServiceCode: profile.municipalServiceCode,
  nbsCode: profile.nbsCode,
  cst: profile.cst,
  classCode: profile.classCode,
  operationIndicator: profile.operationIndicator,
  source: 'company_service_profile',
  serviceProfileId: profile.id,
  operationNature: profile.operationNature,
  iss: {
    taxation: profile.issTaxation,
    rate: profile.issRate,
    withholdingDefault: profile.issWithholdingDefault,
    incidenceMunicipalityCode: profile.incidenceMunicipalityCode,
  },
  withholding: {
    policy: profile.withholdingPolicy,
    rates: profile.withholdingRates,
  },
  catalogVersions: {},
  catalogValidated: false,
  justification: `${CLASSIFICATION_JUSTIFICATION_PROFILE_PREFIX}${profile.name}`,
});

const partialCatalogClassification = (
  invoice: NormalizedInvoice,
): ServiceTaxClassification => ({
  serviceCode: invoice.service.code,
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
  justification: CLASSIFICATION_JUSTIFICATION_FALLBACK,
});

const overrideClassification = (
  invoice: NormalizedInvoice,
  fillProfile: CompanyServiceTaxProfile | null,
): ServiceTaxClassification => ({
  serviceCode: invoice.service.code,
  municipalServiceCode:
    fillProfile === null ? null : fillProfile.municipalServiceCode,
  nbsCode:
    overrideField(invoice.service.fiscal, 'nbsCode') ??
    (fillProfile === null ? null : fillProfile.nbsCode),
  cst:
    overrideField(invoice.service.fiscal, 'cst') ??
    (fillProfile === null ? null : fillProfile.cst),
  classCode:
    overrideField(invoice.service.fiscal, 'classCode') ??
    (fillProfile === null ? null : fillProfile.classCode),
  operationIndicator:
    overrideField(invoice.service.fiscal, 'operationIndicator') ??
    (fillProfile === null ? null : fillProfile.operationIndicator),
  source: 'request_override',
  serviceProfileId: fillProfile === null ? null : fillProfile.id,
  operationNature:
    fillProfile === null ? 'SERVICE' : fillProfile.operationNature,
  iss:
    fillProfile === null
      ? {
          taxation: null,
          rate: null,
          withholdingDefault: false,
          incidenceMunicipalityCode: null,
        }
      : {
          taxation: fillProfile.issTaxation,
          rate: fillProfile.issRate,
          withholdingDefault: fillProfile.issWithholdingDefault,
          incidenceMunicipalityCode: fillProfile.incidenceMunicipalityCode,
        },
  withholding:
    fillProfile === null
      ? { policy: 'UNKNOWN', rates: {} }
      : {
          policy: fillProfile.withholdingPolicy,
          rates: fillProfile.withholdingRates,
        },
  catalogVersions: {},
  catalogValidated: false,
  justification: CLASSIFICATION_JUSTIFICATION_OVERRIDE,
});

const validateAgainstCatalog = async (
  classification: ServiceTaxClassification,
  catalog: IFiscalCatalog,
  date: string,
): Promise<Result<ServiceTaxClassification, FiscalError>> => {
  const validation = await catalog.validateClassification(
    {
      serviceCode: classification.serviceCode,
      nbsCode: classification.nbsCode,
      cst: classification.cst,
      classCode: classification.classCode,
      operationIndicator: classification.operationIndicator,
    },
    date,
  );
  if (validation.status === 'invalid') {
    return err(
      fiscalError({
        code: 'FISCAL_CLASSIFICATION_INVALID',
        message: 'Service classification failed official catalog validation',
        category: 'CLASSIFICATION',
        details: { issues: validation.issues },
      }),
    );
  }
  if (validation.status === 'ambiguous') {
    return err(
      fiscalError({
        code: 'FISCAL_CLASSIFICATION_AMBIGUOUS',
        message: 'Service classification matches multiple catalog entries',
        category: 'CLASSIFICATION',
        details: { candidates: validation.candidates },
      }),
    );
  }
  if (validation.status === 'unavailable') {
    if (validation.transient) {
      return err(
        fiscalError({
          code: 'TAX_CALCULATION_UNAVAILABLE',
          message: `Fiscal catalog validation is temporarily unavailable: ${validation.reason}`,
          category: 'INTEGRATION',
          details: {
            reason: 'catalog_validation_unavailable',
            detail: validation.reason,
          },
          retryable: true,
        }),
      );
    }
    return ok({
      ...classification,
      catalogValidated: false,
      catalogVersions: {},
    });
  }
  return ok({
    ...classification,
    catalogValidated: true,
    catalogVersions: validation.versions,
  });
};

/**
 * Priority (plan Task 10):
 * 1. `service.code` must exist in the official cTribNac catalog.
 * 2. Explicit `invoice.service.fiscal` override (source: request_override),
 *    completed only from the matching approved company service profile.
 * 3. Company service profile: explicit `serviceProfileId` or the effective
 *    profiles for the service code (one candidate only, never the first).
 * 4. Partial classification from the official catalog. Missing IBS/CBS fields
 *    are the applicability step's concern (FISCAL_CLASSIFICATION_REQUIRED).
 */
export async function classifyService(input: {
  invoice: NormalizedInvoice;
  profile: CompanyFiscalProfile;
  serviceProfiles: CompanyServiceTaxProfile[];
  requestedProfileId: string | null;
  catalog: IFiscalCatalog;
}): Promise<Result<ServiceTaxClassification, FiscalError>> {
  const { invoice, profile, serviceProfiles, requestedProfileId, catalog } =
    input;

  const lookup = catalog.lookupServiceCode(invoice.service.code);
  if (!lookup.found) {
    return err(
      fiscalError({
        code: 'FISCAL_CLASSIFICATION_INVALID',
        message: `Service code ${invoice.service.code} was not found in the official cTribNac catalog`,
        category: 'CLASSIFICATION',
        details: { field: 'service.code' },
      }),
    );
  }

  if (hasOverride(invoice.service.fiscal)) {
    return validateAgainstCatalog(
      overrideClassification(invoice, selectFillProfile(input)),
      catalog,
      invoice.competenceDate,
    );
  }

  if (requestedProfileId !== null) {
    const matches = serviceProfiles.filter(
      (candidate) =>
        candidate.id === requestedProfileId &&
        belongsToInvoice(candidate, invoice) &&
        effectiveOn(candidate, invoice.competenceDate) &&
        regimeMatches(candidate, profile.taxRegime),
    );
    if (matches.length === 0) {
      return err(
        fiscalError({
          code: 'FISCAL_CLASSIFICATION_INVALID',
          message: `Requested service profile ${requestedProfileId} does not exist for this company, is not effective on the competence date or excludes the tax regime`,
          category: 'CLASSIFICATION',
          details: { serviceProfileId: requestedProfileId },
        }),
      );
    }
    if (matches.length > 1) {
      return err(
        fiscalError({
          code: 'FISCAL_CLASSIFICATION_AMBIGUOUS',
          message:
            'Multiple service profiles match the requested service profile id',
          category: 'CLASSIFICATION',
          details: { candidates: matches.map((candidate) => candidate.id) },
        }),
      );
    }
    const selected = matches[0];
    const review = reviewError(selected, invoice.environment);
    if (review !== null) return err(review);
    return validateAgainstCatalog(
      classificationFromProfile(invoice, selected),
      catalog,
      invoice.competenceDate,
    );
  }

  const candidates = serviceProfiles.filter(
    (candidate) =>
      belongsToInvoice(candidate, invoice) &&
      effectiveOn(candidate, invoice.competenceDate) &&
      regimeMatches(candidate, profile.taxRegime),
  );
  if (candidates.length > 1) {
    return err(
      fiscalError({
        code: 'FISCAL_CLASSIFICATION_AMBIGUOUS',
        message:
          'Multiple service profiles are effective for this service code',
        category: 'CLASSIFICATION',
        details: { candidates: candidates.map((candidate) => candidate.id) },
      }),
    );
  }
  if (candidates.length === 1) {
    const selected = candidates[0];
    const review = reviewError(selected, invoice.environment);
    if (review !== null) return err(review);
    return validateAgainstCatalog(
      classificationFromProfile(invoice, selected),
      catalog,
      invoice.competenceDate,
    );
  }

  return ok(partialCatalogClassification(invoice));
}

/**
 * The only profile allowed to complete missing override fields: the explicitly
 * requested one, or the single effective profile for the service code. It must
 * be approved; ambiguity or absence never resolves to "the first" profile.
 */
function selectFillProfile(input: {
  invoice: NormalizedInvoice;
  profile: CompanyFiscalProfile;
  serviceProfiles: CompanyServiceTaxProfile[];
  requestedProfileId: string | null;
}): CompanyServiceTaxProfile | null {
  const { invoice, profile, serviceProfiles, requestedProfileId } = input;
  const eligible = serviceProfiles.filter(
    (candidate) =>
      belongsToInvoice(candidate, invoice) &&
      effectiveOn(candidate, invoice.competenceDate) &&
      regimeMatches(candidate, profile.taxRegime) &&
      candidate.reviewStatus === 'approved' &&
      (requestedProfileId === null || candidate.id === requestedProfileId),
  );
  return eligible.length === 1 ? eligible[0] : null;
}
