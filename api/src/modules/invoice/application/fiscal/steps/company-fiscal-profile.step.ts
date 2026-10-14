import { Injectable } from '@nestjs/common';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import type { FiscalStep, StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';

@Injectable()
export class CompanyFiscalProfileStep implements FiscalStep {
  readonly name = 'CompanyFiscalProfile';
  readonly required = true;

  constructor(private readonly profiles: IFiscalProfileReader) {}

  async execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>> {
    if (this.profiles === null || this.profiles === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'CompanyFiscalProfile requires the fiscal profile reader port',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'fiscal_profile_reader_missing' },
        }),
      );
    }

    const { invoice } = context;
    const profiles = await this.profiles.findEffectiveByDate(
      invoice.company.id,
      invoice.tenantId,
      invoice.competenceDate,
    );

    if (profiles.length === 0) {
      return err(
        fiscalError({
          code: 'FISCAL_PROFILE_NOT_EFFECTIVE',
          message: 'No fiscal profile is effective on the competence date',
          category: 'CONFIGURATION',
          step: this.name,
          details: { competenceDate: invoice.competenceDate },
        }),
      );
    }
    if (profiles.length > 1) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'Multiple fiscal profiles are effective on the competence date',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'overlapping_fiscal_profiles', count: profiles.length },
        }),
      );
    }

    const profile = profiles[0];
    if (
      profile.reviewStatus === 'rejected' ||
      (invoice.environment === 'live' && profile.reviewStatus !== 'approved')
    ) {
      return err(
        fiscalError({
          code: 'FISCAL_REVIEW_REQUIRED',
          message: 'Fiscal profile requires approval before live emission',
          category: 'CONFIGURATION',
          step: this.name,
          details: { profileId: profile.id, reviewStatus: profile.reviewStatus },
        }),
      );
    }

    const warnings =
      profile.reviewStatus === 'unreviewed'
        ? [
            ...context.warnings,
            {
              code: 'FISCAL_PROFILE_UNREVIEWED',
              message: 'Fiscal profile is not approved',
              step: this.name,
            },
          ]
        : context.warnings;

    return ok({ status: 'applied', context: { ...context, companyProfile: profile, warnings } });
  }
}
