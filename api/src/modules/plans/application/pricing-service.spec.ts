import { PricingService } from './pricing.service';
import type { BillingCycle } from '../domain/plan';

describe('PricingService monthly catalog', () => {
  const service = new PricingService();
  it.each([
    ['free', 0, 15, 0],
    ['developer', 2990, 200, 18],
    ['growth', 9990, 850, 14],
    ['scale', 29990, 3000, 12],
    ['volume', 69990, 10000, 9],
  ] as const)(
    'quotes %s in BRL with the agreed allowance and excess price',
    (slug, price, included, excess) => {
      expect(service.calculateQuote(slug)).toMatchObject({
        monthlyTotalCents: price,
        monthlyAllowance: included,
        perCreditOverageCents: excess,
        currency: 'BRL',
      });
      expect(service.calculateQuote(slug)).not.toHaveProperty(
        'annualTotalCents',
      );
    },
  );
  it('refuses annual and unknown cycles even from untyped callers', () => {
    expect(() =>
      service.calculateQuote('developer', 'annual' as BillingCycle),
    ).toThrow('Only monthly');
  });
  it('lists exactly the five supported plans', () => {
    expect(service.listAllQuotes('monthly')).toHaveLength(5);
  });
  it('estimates excess above the highest included volume', () => {
    expect(service.recommendPlanForVolume(10000)).toMatchObject({
      planSlug: 'volume',
      overageCredits: 0,
      overageCostCents: 0,
    });
  });
});
