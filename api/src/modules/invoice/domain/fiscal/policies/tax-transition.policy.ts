import { fiscalError, type FiscalError } from '../fiscal-error';
import { err, ok, type Result } from '../result';
import { RULES_VERSION, TAX_RULES } from './rules';
import type { TaxRule } from './tax-rule';

type TaxRuleFor<K extends TaxRule['ruleKey']> = Extract<TaxRule, { ruleKey: K }>;
type IbsCbsInformationRule = TaxRuleFor<'nfse.ibscbs-information'>;

const OPEN_ENDED = '9999-12-31';

const rangeEnd = (rule: TaxRule): string => rule.validUntil ?? OPEN_ENDED;
const rangeKey = (rule: TaxRule): string => `${rule.validFrom}..${rangeEnd(rule)}`;
const covers = (rule: TaxRule, date: string): boolean => rule.validFrom <= date && date <= rangeEnd(rule);
const intersects = (a: TaxRule, b: TaxRule): boolean => {
  const start = a.validFrom > b.validFrom ? a.validFrom : b.validFrom;
  const end = rangeEnd(a) < rangeEnd(b) ? rangeEnd(a) : rangeEnd(b);
  return start <= end;
};
const contains = (outer: TaxRule, inner: TaxRule): boolean =>
  outer.validFrom <= inner.validFrom && rangeEnd(outer) >= rangeEnd(inner);

/**
 * Versioned fiscal rules consulted by date. All dates are ISO 'YYYY-MM-DD'
 * strings compared lexicographically; the policy never does tax math itself,
 * it only selects and exposes the authoritative rule entries.
 */
export class TaxTransitionPolicy {
  readonly rulesVersion: string = RULES_VERSION;

  private readonly rules: readonly TaxRule[];

  constructor(rules: readonly TaxRule[] = TAX_RULES) {
    this.rules = rules;
    this.assertNoPartialOverlaps();
  }

  /**
   * Ranges of the same ruleKey may be nested (a refinement rule inside a base
   * rule) or exact duplicates, but two ranges that only partially overlap are
   * incoherent configuration, so they are an internal Error, not a FiscalError.
   */
  private assertNoPartialOverlaps(): void {
    for (let i = 0; i < this.rules.length; i += 1) {
      for (let j = i + 1; j < this.rules.length; j += 1) {
        const a = this.rules[i];
        const b = this.rules[j];
        if (a.ruleKey !== b.ruleKey) continue;
        if (!intersects(a, b)) continue;
        if (contains(a, b) || contains(b, a)) continue;
        throw new Error(
          `Ambiguous overlapping valid ranges for rule "${a.ruleKey}": [${rangeKey(a)}] overlaps [${rangeKey(b)}]`,
        );
      }
    }
  }

  select<K extends TaxRule['ruleKey']>(
    ruleKey: K,
    date: string,
  ): Result<TaxRuleFor<K>, FiscalError> {
    const configured = this.rules.filter((rule): rule is TaxRuleFor<K> => rule.ruleKey === ruleKey);
    if (configured.length === 0) return err(this.noRuleError(ruleKey, date));

    const distinctRanges = new Map<string, TaxRuleFor<K>>();
    for (const rule of configured) {
      if (!covers(rule, date)) continue;
      const key = rangeKey(rule);
      if (!distinctRanges.has(key)) distinctRanges.set(key, rule);
    }

    const effective = [...distinctRanges.values()];
    if (effective.length === 1) return ok(effective[0]);
    if (effective.length > 1) return err(this.ambiguousError(ruleKey, date));

    // Nothing covers the date. A rule that is already published but only takes
    // effect later is still selected (its parameters state when), so callers
    // can read effectiveFrom; only a key without rules or a date past every
    // range is a failure.
    const upcoming = configured
      .filter((rule) => rule.validFrom > date)
      .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
    if (upcoming.length > 0) return ok(upcoming[0]);
    return err(this.noRuleError(ruleKey, date));
  }

  ibsCbsInformation(
    serviceCode: string,
    date: string,
  ): {
    phase: 'NOT_YET_REQUIRED' | 'REQUIRED';
    toleratedBySefin: boolean;
    rule: IbsCbsInformationRule;
  } {
    const infoRules = this.rules.filter(
      (rule): rule is IbsCbsInformationRule => rule.ruleKey === 'nfse.ibscbs-information',
    );
    if (infoRules.length === 0) {
      // Internal invariant: the transition policy is unusable without the
      // NFS-e information milestones. Not an expected/fiscal failure.
      throw new Error('TaxTransitionPolicy: no "nfse.ibscbs-information" rule configured');
    }

    const ordered = [...infoRules].sort((a, b) =>
      a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0,
    );
    const covering = ordered.filter((rule) => covers(rule, date));
    const isSpecificCategory = infoRules.some((rule) =>
      rule.parameters.specificCategoryServiceCodes.includes(serviceCode),
    );

    let rule: IbsCbsInformationRule;
    if (covering.length > 0) {
      rule = isSpecificCategory ? covering[covering.length - 1] : covering[0];
    } else {
      rule = date < ordered[0].validFrom ? ordered[0] : ordered[ordered.length - 1];
    }

    const requiredFrom = isSpecificCategory
      ? rule.parameters.specificCategoriesFrom
      : rule.parameters.generalFrom;

    return {
      phase: date >= requiredFrom ? 'REQUIRED' : 'NOT_YET_REQUIRED',
      toleratedBySefin: date <= rule.parameters.sefinToleranceUntil,
      rule,
    };
  }

  private noRuleError(ruleKey: string, date: string): FiscalError {
    return fiscalError({
      code: 'TAX_RULE_NOT_EFFECTIVE',
      category: 'CONFIGURATION',
      step: 'TaxTransitionPolicy.select',
      message: `No effective rule "${ruleKey}" for date ${date}`,
      details: { ruleKey, date },
    });
  }

  private ambiguousError(ruleKey: string, date: string): FiscalError {
    return fiscalError({
      code: 'TAX_RULE_NOT_EFFECTIVE',
      category: 'CONFIGURATION',
      step: 'TaxTransitionPolicy.select',
      message: `Ambiguous rules for "${ruleKey}" on ${date}`,
      details: { ruleKey, date },
    });
  }
}
