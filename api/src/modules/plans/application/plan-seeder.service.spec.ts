import { Plan } from '../domain/plan';
import { PlanSeederService } from './plan-seeder.service';

it('seeds the no-plan placeholder with 0 notes and the four paid plans', async () => {
  const save = jest.fn(async (plan: Plan) => plan);
  const service = new PlanSeederService({
    findBySlug: jest.fn().mockResolvedValue(null),
    save,
  } as never);
  await service.seedIfMissing();
  expect(
    save.mock.calls.map(([plan]) => [plan.slug, plan.monthlyCreditAllowance]),
  ).toEqual([
    ['free', 0],
    ['solo', 100],
    ['equipe', 250],
    ['empresa', 600],
    ['escala', 1200],
  ]);
  expect(save.mock.calls[0]?.[0].toSnapshot()).toMatchObject({
    dailyLimit: null,
    creditUnitPriceCents: 99,
  });
});

it('seeds one company for "no plan" (avulso only) and unlimited companies for every recurring plan', async () => {
  const save = jest.fn(async (plan: Plan) => plan);
  const service = new PlanSeederService({
    findBySlug: jest.fn().mockResolvedValue(null),
    save,
  } as never);
  await service.seedIfMissing();
  const limits = Object.fromEntries(
    save.mock.calls.map(([plan]) => [plan.slug, plan.maxActiveCompanies]),
  );
  expect(limits).toEqual({
    free: 1,
    solo: 999999,
    equipe: 999999,
    empresa: 999999,
    escala: 999999,
  });
});
