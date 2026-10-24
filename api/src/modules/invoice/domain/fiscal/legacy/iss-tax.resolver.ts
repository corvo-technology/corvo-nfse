import type { Decimal } from '../money';
import { moneyString, percentOf, rateString } from '../money';
import type { TaxAmount } from '../tax-amount';

export interface IssResolution {
  readonly iss: TaxAmount;
  readonly issResponsible: 'PROVIDER' | 'CUSTOMER';
}

/**
 * ISS municipal: base = gross - discount - deduction (LC 116/2003, art. 7º —
 * the unconditional discount does not integrate the tax base). The deduction
 * is declared by the issuer (e.g. the partner professional share of a salon
 * partnership, Lei 13.352/2016). Amount is rounded HALF_UP to two places
 * exactly once, at the per-tax amount.
 */
export function resolveIss(input: {
  gross: Decimal;
  discount: Decimal;
  /** Issuer-declared deduction from the base; omitted means none. */
  deduction?: Decimal;
  ratePercent: Decimal;
  withheld: boolean;
}): IssResolution {
  const base = input.deduction
    ? input.gross.minus(input.discount).minus(input.deduction)
    : input.gross.minus(input.discount);
  return {
    iss: {
      base: moneyString(base),
      rate: rateString(input.ratePercent),
      amount: moneyString(percentOf(base, input.ratePercent)),
    },
    issResponsible: input.withheld ? 'CUSTOMER' : 'PROVIDER',
  };
}
