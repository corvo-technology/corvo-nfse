import { Plan } from '../domain/plan';
import { PlanSeederService } from './plan-seeder.service';

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
    ['developer', 250],
    ['growth', 1500],
    ['scale', 6000],
    ['volume', 20000],
  ]);
  expect(save.mock.calls[0]?.[0].toSnapshot()).toMatchObject({
    dailyLimit: 3,
    maxActiveCompanies: 1,
    creditUnitPriceCents: 0,
  });
});
