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
