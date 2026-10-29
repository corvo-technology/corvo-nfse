import { Injectable } from '@nestjs/common';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { commonObligations } from './common-obligations';
import { regularIbsCbs } from './regular-tax.strategy';
import type {
  StrategyInput,
  StrategyPlanResult,
  TaxStrategy,
} from './tax-strategy';

@Injectable()
export class SimplesNacionalTaxStrategy implements TaxStrategy {
  readonly name = 'simples-nacional';

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

    // The rate is the company's effective ISS rate of the Simples bracket of
    // the previous month (LC 123/2006, art. 21, §4º, I); without it the DPS
    // cannot carry the mandatory pAliq when retention applies (Sefin 656/658).
    const issWithheld: Obligation =
      common.value.issWithheld.status === 'REQUIRED' &&
      (profile.simplesIssRate === null || profile.simplesIssRate === undefined)
        ? {
            status: 'MISSING_CONFIGURATION',
            reason:
              'ISS withholding for Simples Nacional ME/EPP requires the effective ISS rate of the previous month (LC 123/2006, art. 21, §4º, I)',
            missingFields: ['fiscalProfile.simplesIssRate'],
          }
        : common.value.issWithheld;

    const iss: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'ISS recolhido no DAS',
    };

    // Once the regular option is active, only IBS/CBS move to the regular
    // regime (Res. CGSN 140 art. 22-A; LC 123 art. 13 §§9º-11); ISS keeps
    // being collected through the DAS and follows the rules above.
    if (ibsCbsInEra && regularOptionActive) {
      const ibscbs = regularIbsCbs(input);
      return ok({
        customerRequired: common.value.customerRequired,
        iss,
        issWithheld,
        federalWithholding: common.value.federalWithholding,
        cbs: ibscbs.cbs,
        ibs: ibscbs.ibs,
        specialTreatment: common.value.specialTreatment,
        collectionWaived: ibscbs.collectionWaived,
      });
    }

    // Without the regular option, IBS/CBS stay inside the DAS and are not highlighted.
    const ibscbs: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: ibsCbsInEra
        ? 'IBS/CBS recolhidos no DAS; o Simples não destaca IBS/CBS sem a opção pelo regime regular'
        : `regras de IBS/CBS do Simples produzem efeitos a partir de ${effectiveFrom}`,
    };

    return ok({
      customerRequired: common.value.customerRequired,
      iss,
      issWithheld,
      federalWithholding: common.value.federalWithholding,
      cbs: ibscbs,
      ibs: ibscbs,
      specialTreatment: common.value.specialTreatment,
      collectionWaived: false,
    });
  }
}
