export const OVERAGE_MULTIPLIER = 5;
export const PAYMENT_GRACE_MS = 7 * 86_400_000;

export function usageSummary(
  included: number,
  authorized: number,
  reserved: number,
  unitCents: number,
) {
  return {
    included_remaining: Math.max(0, included - authorized - reserved),
    overage_units: Math.max(0, authorized - included),
    overage_amount_cents: Math.max(0, authorized - included) * unitCents,
    hard_limit: included * (unitCents > 0 ? OVERAGE_MULTIPLIER : 1),
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
