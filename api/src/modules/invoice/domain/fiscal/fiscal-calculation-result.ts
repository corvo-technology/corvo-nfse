import type { TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import type { TaxApplicability } from './applicability/tax-applicability';
import type { ServiceTaxClassification } from './classification/service-tax-classification';
import type { FiscalWarning, StepTrace } from './fiscal-context';
import type { DecimalString } from './money';
import type { WithholdingAmount } from './legacy/legacy-tax-result';
import type { TaxAmount } from './tax-amount';

export type CalculationSource = 'legacy' | 'rtc' | 'legacy+rtc' | 'none';

export interface TaxableAmounts {
  readonly gross: DecimalString;
  readonly discount: DecimalString;
  readonly iss?: DecimalString;
  readonly ibsCbs?: DecimalString;
}

export interface CalculatedTaxes {
  readonly iss?: TaxAmount;
  readonly cbs?: TaxAmount;
  readonly ibsState?: TaxAmount;
  readonly ibsCity?: TaxAmount;
  readonly ibsTotal?: TaxAmount;
}

export interface FiscalCalculationResult {
  /** Same as the invoice id. */
  readonly operationId: string;
  readonly companyId: string;
  readonly competenceDate: string;
  readonly taxRegime: TaxRegimeKind;
  readonly profileId: string;
  /** Frozen inputs; optional only for snapshots written before this contract. */
  readonly emissionProfile?: {
    readonly specialTaxRegime: string | null;
    readonly simplesIssRate: string | null;
  };
  readonly classification: ServiceTaxClassification;
  readonly taxableAmounts: TaxableAmounts;
  readonly taxes: CalculatedTaxes;
  readonly withholdings: readonly WithholdingAmount[];
  readonly netReceivableAmount: DecimalString;
  readonly applicability: TaxApplicability;
  readonly collectionWaived: boolean;
  readonly calculationSource: CalculationSource;
  readonly calculatorVersion: string | null;
  readonly catalogVersions: Record<string, string>;
  readonly rulesVersion: string;
  readonly legalReferences: readonly string[];
  readonly warnings: readonly FiscalWarning[];
  readonly requiresReview: boolean;
  readonly trace: readonly StepTrace[];
  readonly calculationMemory: readonly unknown[];
}
