import { BadRequestException, Injectable } from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  InvoiceDomainService,
  type NormalizedInvoiceInput,
} from '../domain/invoice-domain.service';
import type { CreateInvoiceDto } from '../http/invoice.dto';
import { defaultServiceDescription } from '../infra/fiscal/service-defaults';

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
        code: company.defaultServiceCode ?? undefined,
        municipalityCode: company.municipalityCode,
      },
    );
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
}
