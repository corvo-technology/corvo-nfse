import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import { effectiveProfilesOn } from '@/modules/company/domain/fiscal-profile';
import { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import { deductionAllowed } from '../domain/fiscal/validation/deduction-policy';
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

export interface PreparedInvoiceInput {
  company: Company;
  normalized: NormalizedInvoiceInput;
  environment: ExecutionEnvironment;
}

@Injectable()
export class InvoiceIntakeService {
  constructor(
    private readonly companies: CompanyService,
    private readonly domain: InvoiceDomainService,
    // Optional so the intake keeps working (rule off) where they are not provided.
    @Optional() private readonly profiles?: CompanyFiscalProfileService,
    @Optional() private readonly flags?: RolloutFlagsService,
  ) {}

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
    await this.assertDeductionAllowed(company, normalized, tenantId);
    // The description is optional: fall back to the service's catalog name.
    if (!normalized.service.description) {
      normalized.service = {
        ...normalized.service,
        description: defaultServiceDescription(normalized.service.code),
      };
    }
    if (mode?.allowFutureCompetence) {
      const { scheduledFor: _scheduledFor, ...calculationInput } = normalized;
      return { company, normalized: calculationInput, environment };
    }
    return { company, normalized, environment };
  }

  /**
   * Anexo I E0436/E0441/E0442: refuse a deduction the Sefin would reject, before
   * any credit is reserved. Uses the profile effective on the competence date.
   */
  private async assertDeductionAllowed(
    company: Company,
    normalized: NormalizedInvoiceInput,
    tenantId: string,
  ): Promise<void> {
    if (!normalized.deduction || normalized.deduction <= 0) return;
    if (!this.flags?.isOn('FISCAL_DPS_CONFORMANCE', tenantId)) return;
    if (!this.profiles) return;
    const date = normalized.competenceDate.toISOString().slice(0, 10);
    const effective = effectiveProfilesOn(
      await this.profiles.list(company.id, tenantId),
      date,
    );
    // Zero or overlapping profiles are reported by the fiscal engine.
    const profile = effective.length === 1 ? effective[0] : undefined;
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
