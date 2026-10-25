import { Injectable, Optional } from '@nestjs/common';
import { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { commonObligations } from './common-obligations';
import type {
  StrategyInput,
  StrategyPlanResult,
  TaxStrategy,
} from './tax-strategy';

/**
 * LC 214/2025 general IBS/CBS start. MEI-specific rules for 2027 are not
 * loaded in this rules version, so from this date IBS/CBS for MEI is
 * UNSUPPORTED — never silently NOT_APPLICABLE.
 */
const MEI_IBS_CBS_FROM = '2027-01-01';

@Injectable()
export class MeiTaxStrategy implements TaxStrategy {
  readonly name = 'mei';

  // Optional so the strategy keeps working where no flags are provided (rule off).
  constructor(@Optional() private readonly flags?: RolloutFlagsService) {}

  supports(profile: CompanyFiscalProfile): boolean {
    return profile.taxRegime === 'MEI';
  }

  plan(input: StrategyInput): Result<StrategyPlanResult, FiscalError> {
    const common = commonObligations(input);
    if (!common.ok) return err(common.error);

    const date = input.invoice.competenceDate;
    const iss: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'ISS recolhido no DAS-MEI',
    };
    const ibscbs: Obligation =
      date < MEI_IBS_CBS_FROM
        ? {
            status: 'NOT_APPLICABLE',
            reason: 'MEI não destaca IBS/CBS na fase de teste de 2026',
          }
        : {
            status: 'UNSUPPORTED',
            reason: 'regras de IBS/CBS do MEI em 2027 ainda não carregadas',
          };

    // Anexo I E0583: a MEI never has ISS withheld by the customer.
    const issWithheld: Obligation = this.flags?.isOn(
      'FISCAL_DPS_CONFORMANCE',
      input.invoice.tenantId,
    )
      ? {
          status: 'NOT_APPLICABLE',
          reason: 'MEI não sofre retenção de ISS (E0583)',
        }
      : common.value.issWithheld;

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
