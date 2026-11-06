import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { CursorQuery } from '@/shared/http/pagination';
import {
  QuotaService,
  QuotaExceededError,
  QuotaExceededReason,
} from '@/modules/plans/application/quota.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { assertRegimeSupported } from '../domain/tax-regime-support';
import {
  registryWarnings,
  SimplesRegistryPort,
  type RegistryWarning,
} from '../domain/registry-check';
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
    @Optional() private readonly registry?: SimplesRegistryPort,
  ) {}

  /**
   * Warnings when the public registry disagrees with the
   * regime or municipality just informed. Never blocks and never throws.
   */
  async registryWarnings(
    company: Company,
    regime: TaxRegime,
  ): Promise<RegistryWarning[]> {
    if (!this.registry) return [];
    try {
      const info = await this.registry.lookup(company.taxId);
      return registryWarnings(
        info,
        regimeKindFromLegacy(regime),
        company.municipalityCode,
      );
    } catch {
      return [];
    }
  }

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
    // Before anything is saved: a refused regime must not leave a company behind.
    assertRegimeSupported(regimeKindFromLegacy(normalized.taxRegime));

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
      if (status.maxActiveCompanies >= 999999)
        await this.companyRepo.save(company, tenantId);
      else
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

    // The CNPJ identifies the company (certificate, DPS numbering, invoices): it never changes.
    if (normalized.taxId && normalized.taxId !== company.taxId)
      throw new FiscalValidationError([
        {
          field: 'taxId',
          code: 'invalid',
          message:
            'taxId cannot be changed: create a new company for another CNPJ',
        },
      ]);
    delete normalized.taxId;

    if (
      normalized.environment &&
      normalized.environment !== company.environment
    )
      throw new BadRequestException({
        code: 'COMPANY_ENVIRONMENT_IMMUTABLE',
        message: 'Company environment is immutable',
      });

    // If any regime field was sent, a new fiscal profile row is appended when the
    // effective regime actually changed (never mutate an approved row in place).
    // The resulting regime is decided, and refused if unsupported, BEFORE anything
    // is saved: a refused change must not leave the company half updated.
    const regimeTouched =
      input.taxRegime !== undefined ||
      input.simpleNational !== undefined ||
      input.specialRegime !== undefined;
    const ratesTouched =
      input.simplesRate !== undefined || input.simplesIssRate !== undefined;
    const current =
      regimeTouched || ratesTouched
        ? await this.profiles.current(id, tenantId)
        : null;
    const mergedRegime = {
      taxRegime:
        input.taxRegime !== undefined
          ? regimeKindFromLegacy(input.taxRegime)
          : (current?.taxRegime ?? 'UNKNOWN'),
      simpleNational: input.simpleNational ?? current?.simpleNational ?? false,
      specialTaxRegime:
        input.specialRegime !== undefined
          ? input.specialRegime.trim() || null
          : (current?.specialTaxRegime ?? null),
    };
    const regimeChanged =
      regimeTouched &&
      !(
        current !== null &&
        mergedRegime.taxRegime === current.taxRegime &&
        mergedRegime.simpleNational === current.simpleNational &&
        mergedRegime.specialTaxRegime === current.specialTaxRegime
      );
    if (regimeChanged) assertRegimeSupported(mergedRegime.taxRegime);

    // The rates only exist for Simples Nacional: ignored for a MEI, and required
    // when a company becomes Simples Nacional without one.
    if (mergedRegime.taxRegime === 'SIMPLES_NACIONAL') {
      if (!(normalized.simplesRate ?? company.simplesRate))
        throw new FiscalValidationError([
          {
            field: 'simplesRate',
            code: 'required',
            message:
              'simplesRate is required for Simples Nacional (the effective rate of your DAS)',
          },
        ]);
    } else {
      delete normalized.simplesRate;
      delete normalized.simplesIssRate;
    }

    company.update(normalized);

    await this.companyRepo.save(company, tenantId);

    if (regimeChanged) {
      await this.profiles.record(id, tenantId, {
        ...mergedRegime,
        ibsCbsRegularOption: current?.ibsCbsRegularOption ?? false,
        ibsCbsRegularFrom: current?.ibsCbsRegularFrom ?? null,
        simplesIssRate: current?.simplesIssRate ?? null,
        simplesApuracao: current?.simplesApuracao ?? null,
        validFrom: todayInEstablishmentTimezone(),
        source: 'company_api',
        ...declarationReview(declaredBy),
      });
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
