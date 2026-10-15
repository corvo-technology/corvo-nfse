import { Injectable } from '@nestjs/common';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { commonObligations } from './common-obligations';
import { loadProvisionalTax } from './provisional-tax';
import { requiresIbsCbs } from './specifications';
import type {
  StrategyInput,
  StrategyPlanResult,
  TaxStrategy,
} from './tax-strategy';

function regularIss(classification: ServiceTaxClassification): Obligation {
  const { taxation, rate } = classification.iss;
  if (taxation === 'EXEMPT') {
    return {
      status: 'NOT_APPLICABLE',
      reason: 'ISS exempt for this operation',
    };
  }
  if (taxation === 'FIXED') {
    return {
      status: 'UNSUPPORTED',
      reason:
        'fixed ISS regime requires fiscal review; not supported by the engine',
    };
  }
  if (taxation === 'NORMAL' && rate !== null) {
    return { status: 'REQUIRED' };
  }
  return {
    status: 'MISSING_CONFIGURATION',
    reason: 'ISS rate is not configured for this service',
    missingFields: ['service.iss.rate'],
  };
}

function regularIbsCbs(input: StrategyInput): {
  cbs: Obligation;
  ibs: Obligation;
  collectionWaived: boolean;
} {
  const { invoice, policy } = input;
  const date = invoice.competenceDate;
  const provisional = loadProvisionalTax(policy, date);
  const collectionWaived = provisional.ok
    ? provisional.value.collectionWaived
    : false;

  const obligation = requiresIbsCbs({
    competenceDate: date,
    serviceCode: invoice.service.code,
    policy,
  });
  if (!obligation.satisfied) {
    const notYet: Obligation = {
      status: 'NOT_APPLICABLE',
      reason: obligation.reason,
    };
    return { cbs: notYet, ibs: notYet, collectionWaived };
  }
  return {
    cbs: { status: 'REQUIRED' },
    ibs: { status: 'REQUIRED' },
    collectionWaived,
  };
}

/**
 * Regular regimes (LUCRO_PRESUMIDO / LUCRO_REAL). `planRegular` is also
 * reused by the Simples Nacional strategy once the regular IBS/CBS option is
 * active, so `supports` stays mutually exclusive across strategies.
 */
@Injectable()
export class RegularTaxStrategy implements TaxStrategy {
  readonly name = 'regular';

  supports(profile: CompanyFiscalProfile): boolean {
    return (
      profile.taxRegime === 'LUCRO_PRESUMIDO' ||
      profile.taxRegime === 'LUCRO_REAL'
    );
  }

  plan(input: StrategyInput): Result<StrategyPlanResult, FiscalError> {
    return this.planRegular(input);
  }

  planRegular(input: StrategyInput): Result<StrategyPlanResult, FiscalError> {
    const common = commonObligations(input);
    if (!common.ok) return err(common.error);
    const ibscbs = regularIbsCbs(input);
    return ok({
      customerRequired: common.value.customerRequired,
      iss: regularIss(input.classification),
      issWithheld: common.value.issWithheld,
      federalWithholding: common.value.federalWithholding,
      cbs: ibscbs.cbs,
      ibs: ibscbs.ibs,
      specialTreatment: common.value.specialTreatment,
      collectionWaived: ibscbs.collectionWaived,
    });
  }
}
