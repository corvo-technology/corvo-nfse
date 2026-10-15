export type RuleStatus = 'published' | 'homologated' | 'in_production';

export interface TaxRuleBase {
  ruleKey: string;
  validFrom: string;
  validUntil: string | null;
  legalReference: string;
  sourceUrl: string;
  status: RuleStatus;
}

export type TaxRule =
  | (TaxRuleBase & {
      ruleKey: 'ibscbs.test-phase';
      parameters: {
        cbsNominalPercent: string;
        ibsNominalPercent: string;
        collectionWaived: boolean;
        excludesSimplesNacional: boolean;
      };
    })
  | (TaxRuleBase & {
      ruleKey: 'nfse.ibscbs-information';
      parameters: {
        generalFrom: string;
        specificCategoriesFrom: string;
        sefinToleranceUntil: string;
        specificCategoryServiceCodes: string[];
      };
    })
  | (TaxRuleBase & {
      ruleKey: 'simples.ibscbs-effective';
      parameters: { effectiveFrom: string };
    })
  | (TaxRuleBase & {
      ruleKey: 'rounding.default';
      parameters: { mode: 'HALF_UP'; places: 2 };
    })
  | (TaxRuleBase & {
      ruleKey: 'reconciliation.tolerance';
      parameters: { absolute: string };
    });
