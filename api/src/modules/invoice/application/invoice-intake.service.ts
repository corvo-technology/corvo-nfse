import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import {
  effectiveProfilesOn,
  type CompanyFiscalProfile,
} from '@/modules/company/domain/fiscal-profile';
import { deductionAllowed } from '../domain/fiscal/validation/deduction-policy';
import { assertRegimeSupported } from '@/modules/company/domain/tax-regime-support';
import type { Company } from '@/modules/company/domain/company';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  InvoiceDomainService,
  type NormalizedInvoiceInput,
} from '../domain/invoice-domain.service';
import type { CreateInvoiceDto } from '../http/invoice.dto';
import {
  DEFAULT_SERVICE_CODE,
  defaultServiceDescription,
} from '../infra/fiscal/service-defaults';

/** A non blocking finding of the intake, reported by the calculation response. */
export interface IntakeWarning {
  readonly code: string;
  readonly message: string;
}

export interface PreparedInvoiceInput {
  company: Company;
  normalized: NormalizedInvoiceInput;
  environment: ExecutionEnvironment;
  warnings: IntakeWarning[];
}

@Injectable()
export class InvoiceIntakeService {
  constructor(
    private readonly companies: CompanyService,
    private readonly domain: InvoiceDomainService,
    // Optional so the intake keeps working (rule off) where they are not provided.
    @Optional() private readonly profiles?: CompanyFiscalProfileService,
  ) {}

  private readonly logger = new Logger(InvoiceIntakeService.name);

  async prepare(
    dto: CreateInvoiceDto,
    tenantId: string,
    environment: ExecutionEnvironment,
    mode?: { allowFutureCompetence?: boolean },
  ): Promise<PreparedInvoiceInput> {
    if (!dto.companyId && !dto.companyTaxId)
      throw new BadRequestException('companyId or companyTaxId is required');
    const company = dto.companyId
      ? await this.companies.findById(dto.companyId, tenantId, environment)
      : await this.companies.findByTaxId(
          dto.companyTaxId ?? '',
          tenantId,
          environment,
        );
    if (!/^\d{7}$/.test(company.municipalityCode ?? '')) {
      throw new FiscalValidationError([
        {
          field: 'company.municipalityCode',
          code: 'required',
          message:
            'Configure a valid municipalityCode on the company before issuing invoices',
        },
      ]);
    }
    const normalized = this.domain.normalizeAndValidate(
      {
        ...dto,
        companyId: company.id,
        ...(mode?.allowFutureCompetence
          ? { options: { ...dto.options, type: 'SCHEDULE' as const } }
          : {}),
      },
      environment,
      {
        code: company.defaultServiceCode ?? DEFAULT_SERVICE_CODE,
        municipalityCode: company.municipalityCode,
      },
    );
    // One profile lookup per invoice, shared by the checks below.
    let profileLookup: Promise<CompanyFiscalProfile | undefined> | undefined;
    const profile = () =>
      (profileLookup ??= this.singleEffectiveProfile(
        company,
        normalized,
        tenantId,
      ));
    await this.assertRegimeSupported(profile);
    await this.assertDeductionAllowed(normalized, profile);
    await this.assertSimplesRate(company, profile);
    const warnings: IntakeWarning[] = [];
    // The description is optional: fall back to the service's catalog name.
    if (!normalized.service.description) {
      normalized.service = {
        ...normalized.service,
        description: defaultServiceDescription(normalized.service.code),
      };
    }
    if (mode?.allowFutureCompetence) {
      const { scheduledFor: _scheduledFor, ...calculationInput } = normalized;
      return { company, normalized: calculationInput, environment, warnings };
    }
    return { company, normalized, environment, warnings };
  }

  /**
   * Refuse, before any credit is reserved, an invoice of a
   * company whose profile on the competence date is not MEI or Simples Nacional.
   */
  private async assertRegimeSupported(
    getProfile: () => Promise<CompanyFiscalProfile | undefined>,
  ): Promise<void> {
    const profile = await getProfile();
    if (profile) assertRegimeSupported(profile.taxRegime);
  }

  /**
   * The one fiscal profile effective on the competence date. Zero or overlapping
   * profiles are reported by the fiscal engine, so they yield undefined here.
   */
  private async singleEffectiveProfile(
    company: Company,
    normalized: NormalizedInvoiceInput,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | undefined> {
    if (!this.profiles) return undefined;
    const date = normalized.competenceDate.toISOString().slice(0, 10);
    const effective = effectiveProfilesOn(
      await this.profiles.list(company.id, tenantId),
      date,
    );
    return effective.length === 1 ? effective[0] : undefined;
  }

  /** A Simples Nacional ME/EPP must have its rate (pTotTribSN): refuse before any credit is reserved. */
  private async assertSimplesRate(
    company: Company,
    getProfile: () => Promise<CompanyFiscalProfile | undefined>,
  ): Promise<void> {
    if (company.simplesRate) return;
    if ((await getProfile())?.taxRegime !== 'SIMPLES_NACIONAL') return;
    throw new FiscalValidationError([
      {
        field: 'simplesRate',
        code: 'simples_rate_required',
        message: `The company's Simples Nacional rate is required to issue (set simplesRate with PATCH /companies/${company.id})`,
      },
    ]);
  }

  /**
   * Anexo I E0436/E0441/E0442: refuse a deduction the Sefin would reject, before
   * any credit is reserved. Uses the profile effective on the competence date.
   */
  private async assertDeductionAllowed(
    normalized: NormalizedInvoiceInput,
    getProfile: () => Promise<CompanyFiscalProfile | undefined>,
  ): Promise<void> {
    if (!normalized.deduction || normalized.deduction <= 0) return;
    const profile = await getProfile();
    if (!profile) return;
    const decision = deductionAllowed({
      taxRegime: profile.taxRegime,
      cTribNac: normalized.service.code,
      regApTribSN: profile.taxRegime === 'SIMPLES_NACIONAL' ? 1 : null,
    });
    if (!decision.allowed)
      throw new FiscalValidationError([
        {
          field: 'deduction',
          code: 'deduction_not_allowed_for_regime',
          message: decision.reason,
        },
      ]);
  }
}
