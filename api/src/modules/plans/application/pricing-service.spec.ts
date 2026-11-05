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

describe('PricingService.recommendForNotes', () => {
  const service = new PricingService();

  it('picks the cheapest way to cover N notes per month', () => {
    // Equipe covers 250 notes for R$ 119,90; Solo + 150 avulsas costs R$ 208,40.
    expect(service.recommendForNotes(250, 'monthly').option).toEqual({
      planSlug: 'equipe',
      avulsoUnits: 0,
      totalCents: 11990,
    });
  });
  it('tops a small plan up with avulso notes when that is cheaper', () => {
    expect(service.recommendForNotes(110, 'monthly').option).toEqual({
      planSlug: 'solo',
      avulsoUnits: 10,
      totalCents: 6980,
    });
  });
  it('recommends avulso only (no plan) for a handful of notes', () => {
    expect(service.recommendForNotes(3, 'monthly').option).toEqual({
      planSlug: null,
      avulsoUnits: 3,
      totalCents: 297,
    });
  });
  it('uses the discounted per-month price in the annual cycle', () => {
    expect(service.recommendForNotes(250, 'annual').option).toEqual({
      planSlug: 'equipe',
      avulsoUnits: 0,
      totalCents: 8390,
    });
  });
  it('lists alternatives, cheapest first, without repeating the pick', () => {
    const result = service.recommendForNotes(250, 'monthly');
    const totals = result.alternatives.map((a) => a.totalCents);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(result.alternatives).not.toContainEqual(result.option);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });
  it.each([0, -5, 2.5, Number.NaN, 1_000_001])('rejects %s notes', (notes) => {
    expect(() => service.recommendForNotes(notes, 'monthly')).toThrow(/notes/i);
  });
});
