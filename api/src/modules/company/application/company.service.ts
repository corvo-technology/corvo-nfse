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
  ) {}

  async create(
    input: CreateCompanyInput,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
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
    return company;
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
