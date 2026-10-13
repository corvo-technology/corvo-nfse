import { BillingPeriod, type BillingPeriodState } from './billing-period';

function state(patch: Partial<BillingPeriodState> = {}): BillingPeriodState {
  return {
    id: 'period',
    tenantId: 'tenant',
    planSlug: 'developer',
    periodStart: new Date('2026-10-01'),
    periodEnd: new Date('2026-11-01'),
    included: 200,
    unitCents: 15,
    authorized: 0,
    reserved: 0,
    reported: 0,
    customerId: 'customer',
    subscriptionId: 'sub',
    meterEventName: 'meter',
    pendingReport: null,
    ...patch,
  };
}
describe('BillingPeriod aggregate', () => {
  it('allows the first excess without granting credits or changing the price', () => {
    const period = new BillingPeriod(state({ authorized: 200 }));
    period.reserve(false, null, 0);
    period.settle(true);
    expect(period.summary).toMatchObject({
      overage_units: 1,
      overage_amount_cents: 15,
      hard_limit: 1000,
    });
  });
  it('counts reservations at the 5x cap and frees a failed attempt', () => {
    const period = new BillingPeriod(state({ authorized: 999, reserved: 1 }));
    expect(() => period.reserve(false, null, 0)).toThrow(
      expect.objectContaining({ code: 'monthly_limit_exceeded' }),
    );
    period.settle(false);
    period.reserve(false, null, 0);
    period.settle(true);
    expect(period.state.authorized).toBe(1000);
    expect(period.summary.overage_amount_cents).toBe(12000);
  });
  it('enforces paid access and free daily quota', () => {
    const period = new BillingPeriod(state());
    expect(() => period.reserve(true, null, 0)).toThrow(
      expect.objectContaining({ code: 'plan_blocked' }),
    );
    expect(() => period.reserve(false, 3, 3)).toThrow(
      expect.objectContaining({ code: 'daily_limit_exceeded' }),
    );
  });
  it('does not allow double settlement of an empty reservation', () => {
    expect(() => new BillingPeriod(state()).settle(true)).toThrow(
      expect.objectContaining({ code: 'invalid_usage_reservation' }),
    );
  });
});
