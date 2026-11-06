import { BillingPeriod, type BillingPeriodState } from './billing-period';

function state(patch: Partial<BillingPeriodState> = {}): BillingPeriodState {
  return {
    id: 'period',
    tenantId: 'tenant',
    planSlug: 'solo',
    periodStart: new Date('2026-10-01'),
    periodEnd: new Date('2026-11-01'),
    included: 100,
    authorized: 0,
    reserved: 0,
    customerId: 'customer',
    subscriptionId: 'sub',
    ...patch,
  };
}
describe('BillingPeriod aggregate', () => {
  it('blocks the note after the included amount, without charging excess', () => {
    const period = new BillingPeriod(state({ authorized: 100 }));
    expect(() => period.reserve(false, null, 0)).toThrow(
      expect.objectContaining({ code: 'monthly_limit_exceeded' }),
    );
    expect(period.summary).toEqual({ included_remaining: 0, hard_limit: 100 });
  });
  it('counts reservations at the cap and frees a failed attempt', () => {
    const period = new BillingPeriod(state({ authorized: 99, reserved: 1 }));
    expect(() => period.reserve(false, null, 0)).toThrow(
      expect.objectContaining({ code: 'monthly_limit_exceeded' }),
    );
    period.settle(false);
    period.reserve(false, null, 0);
    period.settle(true);
    expect(period.state.authorized).toBe(100);
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
