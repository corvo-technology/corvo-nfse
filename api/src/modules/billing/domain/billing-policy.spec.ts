import {
  hasPaidAccess,
  PAYMENT_GRACE_MS,
  usageSummary,
} from './billing-policy';

describe('monthly billing policy', () => {
  it('reserves capacity without charging an attempt', () => {
    expect(usageSummary(100, 99, 1)).toEqual({
      included_remaining: 0,
      hard_limit: 100,
    });
  });
  it('never allows more than the included notes (no overage cap multiplier)', () => {
    expect(usageSummary(100, 100, 0)).toEqual({
      included_remaining: 0,
      hard_limit: 100,
    });
    expect(usageSummary(100, 0, 0).hard_limit).toBe(100);
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
