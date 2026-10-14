import { moneyString, toDecimal } from '../money';
import { netReceivable, resolveWithholdings } from './withholding.resolver';

describe('resolveWithholdings', () => {
  it('computes each configured rate and ignores unset ones', () => {
    const r = resolveWithholdings({
      base: toDecimal('900.00'),
      rates: { irrf: '1.5', cofins: '0.65' },
    });
    expect(r).toEqual([
      { tax: 'IRRF', base: '900.00', rate: '1.5', amount: '13.50' },
      { tax: 'COFINS', base: '900.00', rate: '0.65', amount: '5.85' },
    ]);
  });

  it('rounds each amount half up at the cent', () => {
    const r = resolveWithholdings({
      base: toDecimal('0.25'),
      rates: { irrf: '2', inss: '11' },
    });
    expect(r).toEqual([
      { tax: 'IRRF', base: '0.25', rate: '2', amount: '0.01' },
      { tax: 'INSS', base: '0.25', rate: '11', amount: '0.03' },
    ]);
  });

  it('returns an empty list when no rate is configured', () => {
    expect(resolveWithholdings({ base: toDecimal('900.00'), rates: {} })).toEqual([]);
  });
});

describe('netReceivable', () => {
  it('subtracts only withheld taxes, never IBS/CBS', () => {
    // gross 1000, discount 100, ISS withheld 45, IRRF 13.50 → 841.50
    const net = netReceivable({
      gross: toDecimal('1000.00'),
      discount: toDecimal('100.00'),
      withholdings: [{ tax: 'IRRF', base: '900.00', rate: '1.5', amount: '13.50' }],
      issWithheldAmount: toDecimal('45.00'),
    });
    expect(moneyString(net)).toBe('841.50');
  });

  it('keeps the ISS when it is not withheld', () => {
    const net = netReceivable({
      gross: toDecimal('1000.00'),
      discount: toDecimal('100.00'),
      withholdings: [],
      issWithheldAmount: null,
    });
    expect(moneyString(net)).toBe('900.00');
  });

  it('yields a plain negative amount when withholdings exceed the base (the step rejects it)', () => {
    const net = netReceivable({
      gross: toDecimal('100.00'),
      discount: toDecimal('0'),
      withholdings: [{ tax: 'INSS', base: '100.00', rate: '150', amount: '150.00' }],
      issWithheldAmount: null,
    });
    expect(net.isNegative()).toBe(true);
    expect(moneyString(net)).toBe('-50.00');
  });
});
