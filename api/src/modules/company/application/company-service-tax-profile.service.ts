import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import type { ProfileReviewStatus } from '../domain/fiscal-profile';
import {
  isServiceTaxProfileEffectiveOn,
  type CompanyServiceTaxProfile,
} from '../domain/service-tax-profile';
import {
  IServiceTaxProfileRepository,
  type NewServiceTaxProfile,
} from '../domain/service-tax-profile.repository';
import { validateServiceTaxProfile } from '../domain/service-tax-profile.validator';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';

/**
 * Fiscal engine resolution outcome: either the effective company
 * classification with its review state (the engine decides what an unreviewed
 * or rejected profile means per environment), or a machine-readable reason why
 * the company catalog could not answer.
 */
export type ServiceTaxProfileResolution =
  | { classification: ServiceTaxClassification; review: ProfileReviewStatus }
  | { code: string; reason: string };

function classificationOf(
  profile: CompanyServiceTaxProfile,
): ServiceTaxClassification {
  return {
    serviceCode: profile.serviceCode,
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
    justification: `company service profile: ${profile.name}`,
  };
}

@Injectable()
export class CompanyServiceTaxProfileService {
  constructor(
    @Inject(IServiceTaxProfileRepository)
    private readonly profiles: IServiceTaxProfileRepository,
  ) {}

  findById(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile | null> {
    return this.profiles.findById(id, companyId, tenantId);
  }

  /**
   * Catalog view for HTTP: the profiles whose validity window contains `date`
   * (defaults to today at the call site).
   */
  list(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]> {
    return this.profiles.findEffectiveByCompany(companyId, tenantId, date);
  }

  /**
   * Creates when `id` is null, overwrites the row identified by `id` otherwise.
   * An approved profile is immutable while its `effectiveFrom` is preserved:
   * changing the code or window of an approved classification must go through
   * a new profile, never a silent rewrite.
   */
  async upsert(
    companyId: string,
    tenantId: string,
    id: string | null,
    input: NewServiceTaxProfile,
  ): Promise<CompanyServiceTaxProfile> {
    if (id !== null) {
      const existing = await this.profiles.findById(id, companyId, tenantId);
      if (!existing)
        throw new NotFoundException('Service tax profile not found');
      if (
        existing.reviewStatus === 'approved' &&
        existing.effectiveFrom === input.effectiveFrom
      )
        throw new ConflictException('immutable_approved_profile');
    }
    const issues = validateServiceTaxProfile(input);
    if (issues.length > 0) throw new FiscalValidationError(issues);
    return this.profiles.upsert(id, companyId, tenantId, input);
  }

  async approve(
    companyId: string,
    tenantId: string,
    id: string,
  ): Promise<CompanyServiceTaxProfile> {
    const existing = await this.profiles.findById(id, companyId, tenantId);
    if (!existing) throw new NotFoundException('Service tax profile not found');
    if (existing.reviewStatus === 'approved') return existing;
    const issues = validateServiceTaxProfile(existing);
    if (issues.length > 0) throw new FiscalValidationError(issues);
    return this.profiles.markApproved(id, companyId, tenantId);
  }

  /**
   * Removes a catalog row. Only unreviewed/rejected profiles whose window
   * already ended can be removed; effective or approved rows must be corrected
   * through a new profile so fiscal history stays auditable.
   */
  async delete(
    companyId: string,
    tenantId: string,
    id: string,
    today: string,
  ): Promise<void> {
    const existing = await this.profiles.findById(id, companyId, tenantId);
    if (!existing) throw new NotFoundException('Service tax profile not found');
    if (existing.reviewStatus === 'approved')
      throw new ConflictException('immutable_approved_profile');
    if (existing.effectiveUntil === null || existing.effectiveUntil >= today)
      throw new ConflictException('service_profile_still_effective');
    await this.profiles.delete(id, companyId, tenantId);
  }

  /**
   * Resolves the company classification for a service code on a date, either
   * from an explicitly requested profile id or from the effective catalog.
   * Never guesses: zero or several effective candidates produce a code/reason
   * for the fiscal engine to fall back or fail explicitly.
   */
  async resolveProfileForFiscalEngine(
    companyId: string,
    tenantId: string,
    requestedProfileId: string | null,
    serviceCode: string,
    date: string,
  ): Promise<ServiceTaxProfileResolution> {
    if (requestedProfileId !== null) {
      const profile = await this.profiles.findById(
        requestedProfileId,
        companyId,
        tenantId,
      );
      if (!profile)
        return {
          code: 'service_profile_not_found',
          reason: `Service tax profile ${requestedProfileId} does not exist for this company`,
        };
      if (profile.serviceCode !== serviceCode)
        return {
          code: 'service_code_mismatch',
          reason: `Service tax profile ${requestedProfileId} belongs to service code ${profile.serviceCode}, not ${serviceCode}`,
        };
      if (!isServiceTaxProfileEffectiveOn(profile, date))
        return {
          code: 'service_profile_not_effective',
          reason: `Service tax profile ${requestedProfileId} is not effective on ${date}`,
        };
      return {
        classification: classificationOf(profile),
        review: profile.reviewStatus,
      };
    }

    const candidates = await this.profiles.findEffectiveByCompanyAndCode(
      companyId,
      tenantId,
      serviceCode,
      date,
    );
    const [first, second] = candidates;
    if (first === undefined)
      return {
        code: 'no_effective_service_profile',
        reason: `No service tax profile is effective for service code ${serviceCode} on ${date}`,
      };
    if (second !== undefined)
      return {
        code: 'ambiguous_service_profile',
        reason: `${candidates.length} service tax profiles are effective for service code ${serviceCode} on ${date}`,
      };
    return {
      classification: classificationOf(first),
      review: first.reviewStatus,
    };
  }
}
