import type { DecimalString } from '@/modules/invoice/domain/fiscal/money';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';

/**
 * Nominal parameters of the provisional (test-phase) IBS/CBS regime, read
 * from the versioned `ibscbs.test-phase` rule. Never hardcoded: when the rule
 * is not in force on the date there is no provisional input to build.
 */
export interface ProvisionalTaxInput {
  readonly cbsNominalPercent: DecimalString;
  readonly ibsNominalPercent: DecimalString;
  /**
   * No reduction rule exists in this rules version; a future reduction rule
   * must feed this field instead of being applied ad hoc by callers.
   */
  readonly reductionPercent: DecimalString | null;
  /** dispensa de recolhimento during the test phase. */
  readonly collectionWaived: boolean;
  readonly excludesSimplesNacional: boolean;
  readonly rulesVersion: string;
}

export function loadProvisionalTax(
  policy: TaxTransitionPolicy,
  date: string,
): Result<ProvisionalTaxInput, FiscalError> {
  const selected = policy.select('ibscbs.test-phase', date);
  if (!selected.ok) return err(selected.error);
  const rule = selected.value;
  // `select` falls back to an upcoming rule; a rule that only takes effect
  // later is not in force on this date, so there is no provisional input.
  if (rule.validFrom > date) {
    return err(
      fiscalError({
        code: 'TAX_RULE_NOT_EFFECTIVE',
        category: 'CONFIGURATION',
        step: 'loadProvisionalTax',
        message: `Test-phase rule "${rule.ruleKey}" is not in force on ${date}`,
        details: { ruleKey: rule.ruleKey, date },
      }),
    );
  }
  return ok({
    cbsNominalPercent: rule.parameters.cbsNominalPercent,
    ibsNominalPercent: rule.parameters.ibsNominalPercent,
    reductionPercent: null,
    collectionWaived: rule.parameters.collectionWaived,
    excludesSimplesNacional: rule.parameters.excludesSimplesNacional,
    rulesVersion: policy.rulesVersion,
  });
}
