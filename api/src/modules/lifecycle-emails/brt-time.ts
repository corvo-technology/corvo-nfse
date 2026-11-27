/** Brazil has no daylight saving time since 2019: São Paulo is always UTC-3. */
const BRT_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** The instant the São Paulo day of `now` began. */
export function brtDayStart(now: Date): Date {
  const local = now.getTime() - BRT_OFFSET_MS;
  return new Date(local - (local % DAY_MS) + BRT_OFFSET_MS);
}

/** [start, end) of a São Paulo calendar month ("2026-10"), as instants. */
export function brtMonthWindow(month: string): { start: Date; end: Date } {
  const [year, mm] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, mm - 1, 1) + BRT_OFFSET_MS),
    end: new Date(Date.UTC(year, mm, 1) + BRT_OFFSET_MS),
  };
}
