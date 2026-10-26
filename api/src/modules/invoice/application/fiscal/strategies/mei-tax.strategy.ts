import { Injectable } from '@nestjs/common';
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

@Injectable()
export class MeiTaxStrategy implements TaxStrategy {
  readonly name = 'mei';

  supports(profile: CompanyFiscalProfile): boolean {
    return profile.taxRegime === 'MEI';
  }

  plan(input: StrategyInput): Result<StrategyPlanResult, FiscalError> {
    const common = commonObligations(input);
    if (!common.ok) return err(common.error);

    const iss: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'ISS recolhido no DAS-MEI',
    };
    const ibscbs: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'MEI não destaca IBS/CBS na NFS-e',
    };

    // Anexo I E0583: a MEI never has ISS withheld by the customer.
    const issWithheld: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: 'MEI não sofre retenção de ISS (E0583)',
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
