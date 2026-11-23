import { SelfHostedPlanAssigner } from './self-hosted-plan-assigner.service';

describe('SelfHostedPlanAssigner', () => {
  function build(plan: { id: string } | null, moved = 3) {
    const plans = { findBySlug: jest.fn().mockResolvedValue(plan) };
    const tenantPlans = {
      moveAllTenantsTo: jest.fn().mockResolvedValue(moved),
    };
    return {
      service: new SelfHostedPlanAssigner(plans as never, tenantPlans as never),
      plans,
      tenantPlans,
    };
  }

  it('moves every tenant that is not on the self-hosted plan', async () => {
    const { service, plans, tenantPlans } = build({ id: 'plan-1' });
    await expect(service.reassignTenants()).resolves.toBe(3);
    expect(plans.findBySlug).toHaveBeenCalledWith('self-hosted');
    expect(tenantPlans.moveAllTenantsTo).toHaveBeenCalledWith('plan-1');
  });

  it('fails startup clearly when the migration has not run', async () => {
    const { service, tenantPlans } = build(null);
    await expect(service.reassignTenants()).rejects.toThrow(/migrations/);
    expect(tenantPlans.moveAllTenantsTo).not.toHaveBeenCalled();
  });
});
