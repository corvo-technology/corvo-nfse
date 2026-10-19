import { PricingService } from './pricing.service';
import type { BillingCycle } from '../domain/plan';

describe('PricingService monthly catalog', () => {
  const service = new PricingService();
  it.each([
    ['free', 0, 15, 0, 1],
    ['dev', 2990, 250, 12, 25],
    ['pro', 9990, 1500, 8, 150],
    ['escala', 29990, 6000, 5, 500],
  ] as const)(
    'quotes %s in BRL with the agreed allowance and excess price',
    (slug, price, included, excess, maxActiveCompanies) => {
      expect(service.calculateQuote(slug)).toMatchObject({
        monthlyTotalCents: price,
        monthlyAllowance: included,
        perCreditOverageCents: excess,
        currency: 'BRL',
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
  it('lists exactly the four plans', () => {
    const quotes = service.listAllQuotes('monthly');
    expect(quotes.map((q) => q.slug)).toEqual(['free', 'dev', 'pro', 'escala']);
  });
  it('recommends a plan within its allowance with no overage', () => {
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
