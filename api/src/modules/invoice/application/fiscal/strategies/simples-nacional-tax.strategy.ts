import { Injectable } from '@nestjs/common';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { commonObligations } from './common-obligations';
import { RegularTaxStrategy } from './regular-tax.strategy';
import type {
  StrategyInput,
  StrategyPlanResult,
  TaxStrategy,
} from './tax-strategy';

@Injectable()
export class SimplesNacionalTaxStrategy implements TaxStrategy {
  readonly name = 'simples-nacional';

  private readonly regular = new RegularTaxStrategy();

  supports(profile: CompanyFiscalProfile): boolean {
    return profile.taxRegime === 'SIMPLES_NACIONAL';
  }

  plan(input: StrategyInput): Result<StrategyPlanResult, FiscalError> {
    const common = commonObligations(input);
    if (!common.ok) return err(common.error);

    const { profile, policy } = input;
    const date = input.invoice.competenceDate;

    const effective = policy.select('simples.ibscbs-effective', date);
    if (!effective.ok) return err(effective.error);
    const effectiveFrom = effective.value.parameters.effectiveFrom;

    const ibsCbsInEra = date >= effectiveFrom;
    const regularOptionActive =
      profile.ibsCbsRegularOption &&
      profile.ibsCbsRegularFrom !== null &&
      profile.ibsCbsRegularFrom <= date;

    // With the regular option active the invoice is planned exactly as a
    // regular-regime one; `supports` stays mutually exclusive because this
    // delegation happens inside this strategy instead of a second one.
    if (ibsCbsInEra && regularOptionActive)
      return this.regular.planRegular(input);

    const iss: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'ISS recolhido no DAS',
    };
    const ibscbs: Obligation = ibsCbsInEra
      ? {
          status: 'UNSUPPORTED',
          reason: 'IBS/CBS dentro do DAS em 2027 ainda não suportado',
        }
      : {
          status: 'NOT_APPLICABLE',
          reason: `regras de IBS/CBS do Simples produzem efeitos a partir de ${effectiveFrom}`,
        };

    return ok({
      customerRequired: common.value.customerRequired,
      iss,
      issWithheld: common.value.issWithheld,
      federalWithholding: common.value.federalWithholding,
      cbs: ibscbs,
      ibs: ibscbs,
      specialTreatment: common.value.specialTreatment,
      collectionWaived: false,
    });
  }
}
