import { toDecimal } from '../money';
import { resolveIss } from './iss-tax.resolver';

describe('resolveIss', () => {
  it('ISS = base × rate (didactic example)', () => {
    const r = resolveIss({
      gross: toDecimal('1000.00'),
      discount: toDecimal('0'),
      ratePercent: toDecimal('3'),
      withheld: false,
    });
    expect(r.iss).toEqual({ base: '1000.00', rate: '3', amount: '30.00' });
    expect(r.issResponsible).toBe('PROVIDER');
  });

  it('deducts the unconditional discount from the base (R$100 off R$1000)', () => {
    const r = resolveIss({
      gross: toDecimal('1000.00'),
      discount: toDecimal('100.00'),
      ratePercent: toDecimal('5'),
      withheld: false,
    });
    expect(r.iss).toMatchObject({ base: '900.00', amount: '45.00' });
  });

  it('deducts the declared deduction from the base (R$40 partner share of R$100)', () => {
    const r = resolveIss({
      gross: toDecimal('100.00'),
      discount: toDecimal('0'),
      deduction: toDecimal('40.00'),
      ratePercent: toDecimal('5'),
      withheld: false,
    });
    expect(r.iss).toEqual({ base: '60.00', rate: '5', amount: '3.00' });
  });

  it('deducts both the discount and the deduction from the base', () => {
    const r = resolveIss({
      gross: toDecimal('100.00'),
      discount: toDecimal('10.00'),
      deduction: toDecimal('40.00'),
      ratePercent: toDecimal('5'),
      withheld: false,
    });
    expect(r.iss).toMatchObject({ base: '50.00', amount: '2.50' });
  });

  it('keeps the previous base when no deduction is given', () => {
    const r = resolveIss({
      gross: toDecimal('100.00'),
      discount: toDecimal('10.00'),
      ratePercent: toDecimal('5'),
      withheld: false,
    });
    expect(r.iss).toMatchObject({ base: '90.00', amount: '4.50' });
  });

  it.each([
    ['0.01', '2', '0.00'],
    ['0.25', '2', '0.01'],
    ['9999999999.99', '5', '500000000.00'],
    ['100.05', '2.5', '2.50'],
  ])('rounds half up at the cent: %s × %s%% = %s', (gross, rate, expected) =>
    expect(
      resolveIss({
        gross: toDecimal(gross),
        discount: toDecimal('0'),
        ratePercent: toDecimal(rate),
        withheld: false,
      }).iss.amount,
    ).toBe(expected),
  );

  it('marks the customer as responsible when withheld', () =>
    expect(
      resolveIss({
        gross: toDecimal('100'),
        discount: toDecimal('0'),
        ratePercent: toDecimal('2'),
        withheld: true,
      }).issResponsible,
    ).toBe('CUSTOMER'));
});
