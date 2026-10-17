import type { TaxAmount } from '../tax-amount';

export interface RtcTaxResult {
  readonly calculatorVersion: string;
  readonly cbs: TaxAmount | null;
  readonly ibsState: TaxAmount | null;
  readonly ibsCity: TaxAmount | null;
  readonly ibsTotal: TaxAmount | null;
  readonly legalReferences: readonly string[];
  readonly calculationMemory: readonly unknown[];
  readonly collectionWaived: boolean;
}
