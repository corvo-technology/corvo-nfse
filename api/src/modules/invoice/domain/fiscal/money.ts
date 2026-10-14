import { Decimal } from '@/shared/types/money';

export { Decimal };

export type DecimalString = string;

export function toDecimal(value: string | number | Decimal): Decimal {
  const d = new Decimal(value);
  if (!d.isFinite()) throw new Error('Decimal value must be finite');
  return d;
}

export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export const moneyString = (value: Decimal): DecimalString =>
  roundMoney(value).toFixed(2);
export const rateString = (value: Decimal): DecimalString => value.toFixed();
export const percentOf = (base: Decimal, ratePercent: Decimal): Decimal =>
  base.mul(ratePercent).div(100);
export const effectiveRate = (
  nominalPercent: Decimal,
  reductionPercent: Decimal,
): Decimal =>
  nominalPercent.mul(new Decimal(1).minus(reductionPercent.div(100)));
