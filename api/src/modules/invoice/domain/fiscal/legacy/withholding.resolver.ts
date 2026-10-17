import type { WithholdingRates } from '@/modules/company/domain/service-tax-profile';
import type { Decimal } from '../money';
import { moneyString, percentOf, rateString, toDecimal } from '../money';
import type { WithholdingAmount } from './legacy-tax-result';

type FederalTax = 'IRRF' | 'PIS' | 'COFINS' | 'CSLL' | 'INSS';

const FEDERAL_RATES: ReadonlyArray<{
  readonly key: keyof WithholdingRates;
  readonly tax: FederalTax;
}> = [
  { key: 'irrf', tax: 'IRRF' },
  { key: 'pis', tax: 'PIS' },
  { key: 'cofins', tax: 'COFINS' },
  { key: 'csll', tax: 'CSLL' },
  { key: 'inss', tax: 'INSS' },
];

/**
 * Federal withholdings: one entry per configured rate over the given base
 * (gross - discount). Unset rates are ignored. Each amount is rounded
 * HALF_UP to two places exactly once, at the per-tax amount.
 */
export function resolveWithholdings(input: {
  base: Decimal;
  rates: WithholdingRates;
}): WithholdingAmount[] {
  const withholdings: WithholdingAmount[] = [];
  for (const { key, tax } of FEDERAL_RATES) {
    const configured = input.rates[key];
    if (configured === undefined || configured === '') continue;
    const rate = toDecimal(configured);
    withholdings.push({
      tax,
      base: moneyString(input.base),
      rate: rateString(rate),
      amount: moneyString(percentOf(input.base, rate)),
    });
  }
  return withholdings;
}

/**
 * Net amount receivable by the provider: gross - discount - federal
 * withholdings - ISS when withheld. IBS/CBS are never subtracted (they do
 * not belong to this function's inputs by construction). Plain math — a
 * negative result is rejected by the caller (LegacyTaxCalculatorStep).
 */
export function netReceivable(input: {
  gross: Decimal;
  discount: Decimal;
  withholdings: readonly WithholdingAmount[];
  issWithheldAmount: Decimal | null;
}): Decimal {
  let net: Decimal = input.gross.minus(input.discount);
  for (const withholding of input.withholdings) {
    net = net.minus(toDecimal(withholding.amount));
  }
  if (input.issWithheldAmount !== null) {
    net = net.minus(input.issWithheldAmount);
  }
  return net;
}
