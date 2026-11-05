import { PricingService } from './pricing.service';
import type { BillingCycle } from '../domain/plan';

describe('PricingService catalog', () => {
  const service = new PricingService();

  it.each([
    ['solo', 5990, 4190, 50280, 100],
    ['equipe', 11990, 8390, 100680, 250],
    ['empresa', 23990, 16790, 201480, 600],
    ['escala', 39990, 27990, 335880, 1200],
  ] as const)(
    'quotes %s monthly and annual in BRL',
    (slug, monthly, annualPerMonth, annualTotal, allowance) => {
      expect(service.calculateQuote(slug, 'monthly')).toMatchObject({
        slug,
        basePriceCents: monthly,
        monthlyEquivalentCents: monthly,
        chargeTotalCents: monthly,
        monthlyAllowance: allowance,
        currency: 'BRL',
      });
      expect(service.calculateQuote(slug, 'annual')).toMatchObject({
        slug,
        basePriceCents: monthly,
        monthlyEquivalentCents: annualPerMonth,
        chargeTotalCents: annualTotal,
        monthlyAllowance: allowance,
      });
    },
  );

  it('has no overage fields on a quote', () => {
    const quote = service.calculateQuote('solo', 'monthly');
    expect(quote).not.toHaveProperty('perCreditOverageCents');
    expect(quote).not.toHaveProperty('monthlyTotalCents');
  });

  it('rejects unknown plans and unknown cycles', () => {
    expect(() => service.calculateQuote('free' as never, 'monthly')).toThrow(
      'Unknown plan',
    );
    expect(() =>
      service.calculateQuote('solo', 'weekly' as BillingCycle),
    ).toThrow('Unsupported billing cycle');
  });

  it('lists exactly the four plans for each cycle', () => {
    expect(service.listAllQuotes('monthly')).toHaveLength(4);
    expect(service.listAllQuotes('annual')).toHaveLength(4);
  });
});
