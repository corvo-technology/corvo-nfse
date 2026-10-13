import {
  hasPaidAccess,
  PAYMENT_GRACE_MS,
  usageSummary,
} from './billing-policy';

describe('monthly billing policy', () => {
  it('reserves capacity without charging an attempt', () => {
    expect(usageSummary(200, 199, 1, 15)).toEqual({
      included_remaining: 0,
      overage_units: 0,
      overage_amount_cents: 0,
      hard_limit: 1000,
    });
  });
  it('charges only authorized excess, one unit at a time', () => {
    expect(usageSummary(200, 250, 10, 15)).toMatchObject({
      overage_units: 50,
      overage_amount_cents: 750,
    });
  });
  it('never enables overage for the free plan', () => {
    expect(usageSummary(30, 30, 0, 0).hard_limit).toBe(30);
  });
  it('blocks unpaid initial subscriptions and expired grace', () => {
    const end = new Date('2026-10-01T00:00:00Z');
    expect(hasPaidAccess('active', null, end)).toBe(false);
    expect(
      hasPaidAccess(
        'past_due',
        end,
        new Date(end.getTime() + PAYMENT_GRACE_MS - 1),
      ),
    ).toBe(true);
    expect(
      hasPaidAccess(
        'past_due',
        end,
        new Date(end.getTime() + PAYMENT_GRACE_MS),
      ),
    ).toBe(false);
    expect(hasPaidAccess('unpaid', end, end)).toBe(false);
    expect(hasPaidAccess('canceled', end, end)).toBe(false);
  });
});
