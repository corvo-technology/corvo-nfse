import { DateTime } from 'luxon';

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export const SCHEDULE_ZONE = 'America/Sao_Paulo';

const DAY_STEP: Record<Exclude<Frequency, 'MONTHLY'>, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
};

function parse(date: string): DateTime {
  return DateTime.fromISO(date, { zone: 'utc' }).startOf('day');
}

/**
 * The index-th occurrence, always counted from the anchor so a clamped month
 * (31 -> 28) never drags the following months along.
 */
export function occurrenceOn(
  anchorOn: string,
  frequency: Frequency,
  index: number,
): string {
  const anchor = parse(anchorOn);
  if (frequency !== 'MONTHLY')
    return anchor.plus({ days: DAY_STEP[frequency] * index }).toISODate()!;
  const target = anchor.startOf('month').plus({ months: index });
  const day = Math.min(anchor.day, target.daysInMonth!);
  return target.set({ day }).toISODate()!;
}

/** First occurrence strictly after `after`: one note per run, no back-filling of missed ones. */
export function firstOccurrenceAfter(
  anchorOn: string,
  frequency: Frequency,
  after: string,
): { index: number; on: string } {
  let index = 0;
  let on = occurrenceOn(anchorOn, frequency, index);
  while (on <= after) {
    index += 1;
    on = occurrenceOn(anchorOn, frequency, index);
  }
  return { index, on };
}

export function todayInSaoPaulo(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: SCHEDULE_ZONE }).toISODate()!;
}

export function tomorrowInSaoPaulo(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: SCHEDULE_ZONE })
    .plus({ days: 1 })
    .toISODate()!;
}

/** Monday to Friday. Holidays are not considered. */
export function isBusinessDay(date: string): boolean {
  return parse(date).weekday <= 5;
}
