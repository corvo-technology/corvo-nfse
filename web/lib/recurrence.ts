import type { ScheduleFrequency } from "./types";

/** Today in São Paulo as YYYY-MM-DD, the day the API counts from. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/**
 * When a recurrence that issues its first note today makes its second one: one period after today.
 * Monthly keeps the day of the month (the last day when the next month is shorter).
 */
export function firstRecurringDate(frequency: ScheduleFrequency, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (frequency === "MONTHLY") {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m - 1, d + (frequency === "WEEKLY" ? 7 : 14))).toISOString().slice(0, 10);
}
