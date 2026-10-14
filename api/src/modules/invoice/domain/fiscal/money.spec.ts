import { Decimal } from '@/shared/types/money';
import {
  effectiveRate,
  moneyString,
  percentOf,
  rateString,
  roundMoney,
  toDecimal,
} from './money';

describe('fiscal money', () => {
  it('computes the 2026 demonstration math exactly', () => {
    const base = toDecimal('1000.00');
    expect(moneyString(percentOf(base, toDecimal('0.9')))).toBe('9.00');
    expect(moneyString(percentOf(base, toDecimal('0.1')))).toBe('1.00');
  });
  it('applies a reduction to the nominal rate', () => {
    const cbs = effectiveRate(toDecimal('0.9'), toDecimal('60'));
    const ibs = effectiveRate(toDecimal('0.1'), toDecimal('60'));
    expect(rateString(cbs)).toBe('0.36');
    expect(rateString(ibs)).toBe('0.04');
    expect(moneyString(percentOf(toDecimal('1000'), cbs))).toBe('3.60');
    expect(moneyString(percentOf(toDecimal('1000'), ibs))).toBe('0.40');
  });
  it('subtracts a discount without float drift', () => {
    expect(moneyString(toDecimal('1000.00').minus('100.00'))).toBe('900.00');
    expect(moneyString(toDecimal('0.1').plus('0.2'))).toBe('0.30');
  });
  it('rounds half up at the cent only', () => {
    expect(roundMoney(new Decimal('0.005')).toFixed(2)).toBe('0.01');
    expect(roundMoney(new Decimal('1.004')).toFixed(2)).toBe('1.00');
  });
  it('rejects non-finite input', () => {
    expect(() => toDecimal('abc')).toThrow();
    expect(() => toDecimal(Number.NaN)).toThrow();
  });
});
