import { Inject, Injectable } from '@nestjs/common';
import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type {
  FiscalStep,
  StepOutcome,
} from '@/modules/invoice/domain/fiscal/fiscal-step';
import { classifyService } from '@/modules/invoice/domain/fiscal/classification/classify-service';
import { IFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import { IServiceProfileReader } from '@/modules/invoice/domain/fiscal/ports/service-profile.reader';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';

@Injectable()
export class ServiceTaxClassifierStep implements FiscalStep {
  readonly name = 'ServiceTaxClassifier';
  readonly required = true;

  constructor(
    @Inject(IServiceProfileReader)
    private readonly serviceProfiles: IServiceProfileReader,
    @Inject(IFiscalCatalog)
    private readonly catalog: IFiscalCatalog,
  ) {}

  async execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>> {
    const { invoice, companyProfile } = context;
    if (companyProfile === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message:
            'ServiceTaxClassifier requires the company fiscal profile produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'company_profile_missing' },
        }),
      );
    }

    const requestedProfileId = invoice.service.serviceProfileId;
    const serviceProfiles = await this.loadProfiles(
      invoice,
      requestedProfileId,
    );
    const result = classifyService({
      invoice,
      profile: companyProfile,
      serviceProfiles,
      requestedProfileId,
      catalog: this.catalog,
    });
    if (!result.ok) {
      const error = result.error;
      return err(
        fiscalError({
          code: error.code,
          message: error.message,
          category: error.category,
          step: this.name,
          details: { ...error.details },
          retryable: error.retryable,
        }),
      );
    }

    const classification = result.value;
    const warnings = classification.catalogValidated
      ? context.warnings
      : [
          ...context.warnings,
          {
            code: 'CLASSIFICATION_NOT_CATALOG_VALIDATED',
            message:
              'Service tax classification was not validated against the official catalog',
            step: this.name,
          },
        ];
    return ok({
      status: 'applied',
      context: { ...context, classification, warnings },
    });
  }

  private async loadProfiles(
    invoice: NormalizedInvoice,
    requestedProfileId: string | null,
  ): Promise<CompanyServiceTaxProfile[]> {
    if (requestedProfileId !== null) {
      const profile = await this.serviceProfiles.findById(
        requestedProfileId,
        invoice.company.id,
        invoice.tenantId,
      );
      return profile === null ? [] : [profile];
    }
    return this.serviceProfiles.findEffectiveByCode(
      invoice.company.id,
      invoice.tenantId,
      invoice.service.code,
      invoice.competenceDate,
    );
  }
}
