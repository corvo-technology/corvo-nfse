import { CursorQuery } from '@/shared/http/pagination';
import {
  QuotaService,
  QuotaExceededError,
  QuotaExceededReason,
} from '@/modules/plans/application/quota.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, BadRequestException } from '@nestjs/common';
import { ICompanyRepository } from '../domain/company.repository';
import {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../domain/company';
import {
  CompanyNotFoundError,
  CompanyNotReadyError,
  CompanyBlockedError,
  CompanyAlreadyExistsError,
} from '../domain/errors';
import { normalizeTaxID } from '@/shared/tax-id';
import { CompanyDomainService } from '../domain/company-domain.service';
import type { TaxRegime } from '../domain/company';
import { CompanyFiscalProfileService } from './company-fiscal-profile.service';
import {
  legacyFromRegimeKind,
  regimeKindFromLegacy,
} from '../domain/fiscal-profile';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';

export interface CurrentCompanyRegime {
  taxRegime: TaxRegime | null;
  simpleNational: boolean;
  specialRegime: string | null;
}

/** A regime declared through the company endpoints is approved by the caller. */
function declarationReview(declaredBy: string | null) {
  return declaredBy === null
    ? ({ reviewStatus: 'unreviewed', reviewedBy: null } as const)
    : ({ reviewStatus: 'approved', reviewedBy: declaredBy } as const);
}

@Injectable()
export class CompanyService {
  listPage(
    tenantId: string,
    options: CursorQuery,
    environment: ExecutionEnvironment,
  ) {
    return this.companyRepo.listPage(tenantId, options, environment);
  }

  constructor(
    private readonly companyRepo: ICompanyRepository,
    private readonly quotaService: QuotaService,
    private readonly companyDomain: CompanyDomainService,
    private readonly profiles: CompanyFiscalProfileService,
  ) {}

  async create(
    input: CreateCompanyInput,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
    declaredBy: string | null = null,
  ): Promise<Company> {
    // Fiscal validation + normalization via domain service.
    // Throws FiscalValidationError (→ 422 with code + details) on failure.
    const normalized = this.companyDomain.validateAndNormalizeCreate({
      ...input,
      environment,
    });

    const exists = await this.companyRepo.existsWithTaxId(
      normalized.taxId,
      tenantId,
      undefined,
      environment,
    );
    if (exists) {
      throw new CompanyAlreadyExistsError(normalized.taxId);
    }

    const company = Company.create({ ...normalized, environment }, tenantId);
    if (environment === 'live') {
      const status = await this.quotaService.getStatus(tenantId);
      if (status.reason === QuotaExceededReason.PLAN_BLOCKED)
        throw new QuotaExceededError(status.reason, {});
      await this.companyRepo.saveWithLimit(
        company,
        status.maxActiveCompanies,
        tenantId,
      );
    } else {
      await this.companyRepo.save(company, tenantId);
    }

    // Record the initial fiscal profile from the request regime (source
    // `company_api`, valid from today). Declaring the regime in the request is
    // the confirmation: the profile is approved by the caller (user or API key)
    // so the company is ready to issue once the certificate is uploaded. The
    // Company aggregate no longer stores the regime — the profile is.
    const regime = regimeKindFromLegacy(normalized.taxRegime);
    await this.profiles.record(company.id, tenantId, {
      taxRegime: regime,
      // Omitted => follows the regime (MEI and Simples Nacional are Simples).
      simpleNational:
        normalized.simpleNational ??
        (regime === 'MEI' || regime === 'SIMPLES_NACIONAL'),
      specialTaxRegime: normalized.specialRegime?.trim() || null,
      ibsCbsRegularOption: false,
      ibsCbsRegularFrom: null,
      simplesIssRate: null,
      validFrom: todayInEstablishmentTimezone(),
      source: 'company_api',
      ...declarationReview(declaredBy),
    });

    return company;
  }

  async findById(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Company> {
    const company = await this.companyRepo.findByIdAndTenantId(
      id,
      tenantId,
      environment,
    );
    if (!company) {
      throw new CompanyNotFoundError(id);
    }
    return company;
  }

  async findByTaxId(
    taxId: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Company> {
    const normalized = normalizeTaxID(taxId);
    const company = normalized
      ? await this.companyRepo.findByTaxIdAndTenantId(
          normalized,
          tenantId,
          environment,
        )
      : null;
    if (!company) {
      throw new CompanyNotFoundError(taxId);
    }
    return company;
  }

  async list(
    tenantId: string,
    limit?: number,
    cursor?: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Company[]> {
    return this.companyRepo.findByTenantId(
      tenantId,
      limit,
      cursor,
      environment,
    );
  }

  async update(
    id: string,
    input: UpdateCompanyInput,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
    declaredBy: string | null = null,
  ): Promise<Company> {
    const company = await this.findById(id, tenantId, environment);

    // Fiscal validation + normalization via domain service.
    // Throws FiscalValidationError (→ 422 with code + details) on failure.
    const normalized = this.companyDomain.validateAndNormalizeUpdate(input);

    if (normalized.taxId && normalized.taxId !== company.taxId) {
      const exists = await this.companyRepo.existsWithTaxId(
        normalized.taxId,
        tenantId,
        company.id,
        environment,
      );
      if (exists) {
        throw new CompanyAlreadyExistsError(normalized.taxId);
      }
    }

    if (
      normalized.environment &&
      normalized.environment !== company.environment
    )
      throw new BadRequestException('Company environment is immutable');

    company.update(normalized);

    await this.companyRepo.save(company, tenantId);

    // If any regime field was sent, append a new fiscal profile row when the
    // effective regime actually changed (never mutate an approved row in place).
    const regimeTouched =
      input.taxRegime !== undefined ||
      input.simpleNational !== undefined ||
      input.specialRegime !== undefined;
    if (regimeTouched) {
      const current = await this.profiles.current(id, tenantId);
      const mergedRegime = {
        taxRegime:
          input.taxRegime !== undefined
            ? regimeKindFromLegacy(input.taxRegime)
            : (current?.taxRegime ?? 'UNKNOWN'),
        simpleNational:
          input.simpleNational ?? current?.simpleNational ?? false,
        specialTaxRegime:
          input.specialRegime !== undefined
            ? input.specialRegime.trim() || null
            : (current?.specialTaxRegime ?? null),
      };
      const unchanged =
        current !== null &&
        mergedRegime.taxRegime === current.taxRegime &&
        mergedRegime.simpleNational === current.simpleNational &&
        mergedRegime.specialTaxRegime === current.specialTaxRegime;
      if (!unchanged) {
        await this.profiles.record(id, tenantId, {
          ...mergedRegime,
          ibsCbsRegularOption: current?.ibsCbsRegularOption ?? false,
          ibsCbsRegularFrom: current?.ibsCbsRegularFrom ?? null,
          simplesIssRate: current?.simplesIssRate ?? null,
          validFrom: todayInEstablishmentTimezone(),
          source: 'company_api',
          ...declarationReview(declaredBy),
        });
      }
    }

    return company;
  }

  /**
   * Returns the company's current fiscal-regime view, read from the open
   * fiscal profile (legacy-shaped values for API compatibility). Returns a
   * null regime when no profile exists yet.
   */
  async currentRegime(
    companyId: string,
    tenantId: string,
  ): Promise<CurrentCompanyRegime> {
    const profile = await this.profiles.current(companyId, tenantId);
    if (!profile) {
      return { taxRegime: null, simpleNational: false, specialRegime: null };
    }
    return {
      taxRegime: legacyFromRegimeKind(profile.taxRegime),
      simpleNational: profile.simpleNational,
      specialRegime: profile.specialTaxRegime,
    };
  }

  /**
   * Batch variant of {@link currentRegime} for list endpoints: returns a
   * companyId → current regime map keyed off each company's open profile.
   */
  async currentRegimesByCompanyIds(
    companyIds: string[],
    tenantId: string,
  ): Promise<Map<string, CurrentCompanyRegime>> {
    const profiles = await this.profiles.currentByCompanyIds(
      companyIds,
      tenantId,
    );
    const regimes = new Map<string, CurrentCompanyRegime>();
    for (const [companyId, profile] of profiles) {
      regimes.set(companyId, {
        taxRegime: legacyFromRegimeKind(profile.taxRegime),
        simpleNational: profile.simpleNational,
        specialRegime: profile.specialTaxRegime,
      });
    }
    return regimes;
  }

  async delete(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<void> {
    const company = await this.findById(id, tenantId, environment);
    company.markDeleted();
    await this.companyRepo.save(company, tenantId);
  }

  async ensureReady(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Company> {
    const company = await this.findById(id, tenantId, environment);

    if (company.status === 'blocked') {
      throw new CompanyBlockedError(id);
    }

    const missing = company.getMissingForReady();
    if (missing.length > 0) {
      throw new CompanyNotReadyError(id, missing);
    }

    return company;
  }

  async syncSetupStatus(
    id: string,
    tenantId: string,
    hasActiveCertificate: boolean,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Company> {
    const company = await this.findById(id, tenantId, environment);
    company.recomputeStatus(hasActiveCertificate);
    await this.companyRepo.save(company, tenantId);
    return company;
  }
}
