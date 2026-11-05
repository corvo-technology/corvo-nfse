import {
  addUtcMonths,
  rollPeriod,
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

  it('adds whole UTC months, clamping to the last day of shorter months', () => {
    expect(
      addUtcMonths(new Date('2026-01-15T10:00:00Z'), 1).toISOString(),
    ).toBe('2026-02-15T10:00:00.000Z');
    expect(
      addUtcMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(),
    ).toBe('2026-02-28T00:00:00.000Z');
    expect(
      addUtcMonths(new Date('2026-03-10T00:00:00Z'), 12).toISOString(),
    ).toBe('2027-03-10T00:00:00.000Z');
  });
  it('rolls an expired monthly period forward while the year is still paid', () => {
    const start = new Date('2026-01-10T00:00:00Z');
    const end = new Date('2026-02-10T00:00:00Z');
    const paidUntil = new Date('2027-01-10T00:00:00Z');
    const rolled = rollPeriod(
      start,
      end,
      paidUntil,
      new Date('2026-03-15T00:00:00Z'),
    );
    expect(rolled.start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(rolled.end.toISOString()).toBe('2026-04-10T00:00:00.000Z');
  });
  it('does not roll a current period, nor beyond what was paid', () => {
    const start = new Date('2026-01-10T00:00:00Z');
    const end = new Date('2026-02-10T00:00:00Z');
    const inside = new Date('2026-01-20T00:00:00Z');
    expect(
      rollPeriod(start, end, new Date('2027-01-10T00:00:00Z'), inside),
    ).toEqual({ start, end });
    const lapsed = new Date('2026-06-01T00:00:00Z');
    expect(
      rollPeriod(start, end, new Date('2026-02-10T00:00:00Z'), lapsed),
    ).toEqual({ start, end });
  });
});
