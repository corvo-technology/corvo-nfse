import { PricingService } from './pricing.service';
import type { BillingCycle } from '../domain/plan';

describe('PricingService monthly catalog', () => {
  const service = new PricingService();
  it.each([
    ['free', 0, 15, 0, false, 1],
    ['dev', 2990, 250, 12, false, 25],
    ['pro', 9990, 1500, 8, false, 150],
    ['escala', 29990, 6000, 5, false, 500],
    ['developer', 2990, 200, 15, true, 10],
    ['growth', 8990, 750, 12, true, 50],
    ['scale', 24990, 2500, 10, true, 500],
    ['volume', 89990, 10000, 9, true, 999999],
  ] as const)(
    'quotes %s in BRL with the agreed allowance and excess price',
    (slug, price, included, excess, legacy, maxActiveCompanies) => {
      expect(service.calculateQuote(slug)).toMatchObject({
        monthlyTotalCents: price,
        monthlyAllowance: included,
        perCreditOverageCents: excess,
        currency: 'BRL',
        legacy,
        maxActiveCompanies,
      });
      expect(service.calculateQuote(slug)).not.toHaveProperty(
        'annualTotalCents',
      );
    },
  );
  it('refuses annual and unknown cycles even from untyped callers', () => {
    expect(() =>
      service.calculateQuote('dev', 'annual' as BillingCycle),
    ).toThrow('Only monthly');
  });
  it('still quotes legacy slugs for grandfathered subscribers', () => {
    expect(service.calculateQuote('growth')).toMatchObject({
      slug: 'growth',
      legacy: true,
      monthlyTotalCents: 8990,
    });
  });
  it('lists exactly the four public catalog plans, excluding legacy', () => {
    const quotes = service.listAllQuotes('monthly');
    expect(quotes.map((q) => q.slug)).toEqual(['free', 'dev', 'pro', 'escala']);
    expect(quotes.every((q) => !q.legacy)).toBe(true);
  });
  it('recommends a catalog plan within its allowance with no overage', () => {
    expect(service.recommendPlanForVolume(1200)).toMatchObject({
      planSlug: 'pro',
      overageCredits: 0,
      overageCostCents: 0,
      totalEstimatedCents: 9990,
    });
  });
  it('recommends the cheapest plan including overage, never a pricier upgrade', () => {
    // 2.000 notes: Pro + 500 x R$0,08 = R$139,90 beats Escala R$299,90 (CFO memo, section 4).
    expect(service.recommendPlanForVolume(2000)).toMatchObject({
      planSlug: 'pro',
      overageCredits: 500,
      overageCostCents: 4000,
      totalEstimatedCents: 13990,
    });
    // Pro to Escala crossover at 4.000 notes.
    expect(service.recommendPlanForVolume(4001).planSlug).toBe('escala');
    expect(service.recommendPlanForVolume(16)).toMatchObject({
      planSlug: 'dev',
    });
    expect(service.recommendPlanForVolume(15).planSlug).toBe('free');
  });
  it('estimates excess above the highest included volume', () => {
    expect(service.recommendPlanForVolume(8000)).toMatchObject({
      planSlug: 'escala',
      overageCredits: 2000,
      overageCostCents: 10000,
    });
  });
});
