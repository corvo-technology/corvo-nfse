import { Plan, PlanSlug } from '../domain/plan';
import { PlanSeederService, SEED_DATA } from './plan-seeder.service';
import { PricingService } from './pricing.service';

it('seeds 15 free invoices per month while preserving all other plan allowances', async () => {
  const save = jest.fn(async (plan: Plan) => plan);
  const service = new PlanSeederService({
    findBySlug: jest.fn().mockResolvedValue(null),
    save,
  } as never);
  await service.seedIfMissing();
  expect(
    save.mock.calls.map(([plan]) => [plan.slug, plan.monthlyCreditAllowance]),
  ).toEqual([
    ['free', 15],
    ['dev', 250],
    ['pro', 1500],
    ['escala', 6000],
  ]);
  expect(save.mock.calls[0]?.[0].toSnapshot()).toMatchObject({
    dailyLimit: 3,
    maxActiveCompanies: 1,
    creditUnitPriceCents: 0,
  });
});

it('never saves a plan that already exists', async () => {
  const save = jest.fn(async (plan: Plan) => plan);
  const service = new PlanSeederService({
    findBySlug: jest.fn().mockResolvedValue({ slug: 'free' }),
    save,
  } as never);
  await service.seedIfMissing();
  expect(save).not.toHaveBeenCalled();
});

it('never drifts from PricingService for allowance/price/overage/maxCompanies', () => {
  const pricing = new PricingService();
  const slugs = Object.keys(SEED_DATA) as PlanSlug[];
  for (const slug of slugs) {
    const quote = pricing.calculateQuote(slug);
    const seeded = SEED_DATA[slug];
    expect(seeded.monthlyCreditAllowance).toBe(quote.monthlyAllowance);
    expect(seeded.creditUnitPriceCents).toBe(quote.perCreditOverageCents);
    expect(seeded.maxActiveCompanies).toBe(quote.maxActiveCompanies);
  }
});
