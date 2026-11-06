export const PAYMENT_GRACE_MS = 7 * 86_400_000;

export function usageSummary(
  included: number,
  authorized: number,
  reserved: number,
) {
  return {
    included_remaining: Math.max(0, included - authorized - reserved),
    hard_limit: included,
  };
}

export function hasPaidAccess(
  status: string | null,
  paidUntil: Date | null,
  now = new Date(),
): boolean {
  if (!paidUntil || !['active', 'past_due'].includes(status ?? ''))
    return false;
  return now.getTime() < paidUntil.getTime() + PAYMENT_GRACE_MS;
}

export function calendarPeriod(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Adds whole UTC months, clamping the day to the last day of shorter months. */
export function addUtcMonths(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

/**
 * A paid plan whose period ended but whose payment still covers `now` (annual
 * plans) moves to the month that contains `now`, keeping the original anchor day.
 */
export function rollPeriod(
  start: Date,
  end: Date,
  paidUntil: Date | null,
  now: Date,
): { start: Date; end: Date } {
  if (!paidUntil || end.getTime() > now.getTime()) return { start, end };
  if (paidUntil.getTime() <= now.getTime()) return { start, end };
  let months = 0;
  let nextStart = start;
  let nextEnd = end;
  while (nextEnd.getTime() <= now.getTime()) {
    months += 1;
    nextStart = addUtcMonths(start, months);
    nextEnd = addUtcMonths(start, months + 1);
  }
  return { start: nextStart, end: nextEnd };
}
