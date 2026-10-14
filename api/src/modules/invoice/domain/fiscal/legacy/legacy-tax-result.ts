import type { DecimalString } from '../money';
import type { TaxAmount } from '../tax-amount';

export interface WithholdingAmount {
  readonly tax: 'ISS' | 'IRRF' | 'PIS' | 'COFINS' | 'CSLL' | 'INSS';
  readonly base: DecimalString;
  readonly rate: DecimalString;
  readonly amount: DecimalString;
}

export interface LegacyTaxResult {
  readonly iss: TaxAmount | null;
  readonly issWithheld: boolean;
  readonly issResponsible: 'PROVIDER' | 'CUSTOMER' | null;
  readonly withholdings: readonly WithholdingAmount[];
  readonly netReceivableAmount: DecimalString;
}
