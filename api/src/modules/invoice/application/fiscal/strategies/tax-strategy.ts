import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { TaxApplicability } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import type { Result } from '@/modules/invoice/domain/fiscal/result';

export interface StrategyInput {
  readonly invoice: NormalizedInvoice;
  readonly profile: CompanyFiscalProfile;
  readonly classification: ServiceTaxClassification;
  readonly policy: TaxTransitionPolicy;
}

/**
 * Strategy-produced obligations. The applicability step attaches the strategy
 * name, the rules version and the legal references of the rules consulted.
 */
export type StrategyPlanResult = Omit<
  TaxApplicability,
  'strategy' | 'rulesVersion' | 'legalReferences'
>;

export interface TaxStrategy {
  readonly name: string;
  supports(profile: CompanyFiscalProfile, competenceDate: string): boolean;
  plan(input: StrategyInput): Result<StrategyPlanResult, FiscalError>;
}
