import type { Decimal } from '../money';
import { moneyString, percentOf, rateString } from '../money';
import type { TaxAmount } from '../tax-amount';

export interface IssResolution {
  readonly iss: TaxAmount;
  readonly issResponsible: 'PROVIDER' | 'CUSTOMER';
}

/**
 * ISS municipal: base = gross - discount (LC 116/2003, art. 7º — the
 * unconditional discount does not integrate the tax base). Amount is rounded
 * HALF_UP to two places exactly once, at the per-tax amount.
 */
export function resolveIss(input: {
  gross: Decimal;
  discount: Decimal;
  ratePercent: Decimal;
  withheld: boolean;
}): IssResolution {
  const base = input.gross.minus(input.discount);
  return {
    iss: {
      base: moneyString(base),
      rate: rateString(input.ratePercent),
      amount: moneyString(percentOf(base, input.ratePercent)),
    },
    issResponsible: input.withheld ? 'CUSTOMER' : 'PROVIDER',
  };
}
