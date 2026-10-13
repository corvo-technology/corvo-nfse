import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

export const DEFAULT_ESTABLISHMENT_TIMEZONE = 'America/Sao_Paulo';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PT_BR_DATE_ONLY_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const OFFSET_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const WEEKDAYS_PT_BR: Record<string, number> = {
  segunda: 1,
  terca: 2,
  terça: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

export function parseInstantWithOffset(
  value: string,
  fieldName = 'datetime',
): Date {
  if (!OFFSET_DATETIME_PATTERN.test(value)) {
    throw new BadRequestException(`${fieldName} must include Z or UTC offset`);
  }

  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) {
    throw new BadRequestException(`${fieldName} must be a valid ISO datetime`);
  }

  return parsed.toUTC().toJSDate();
}

export function parseLocalDate(value: string, fieldName = 'date'): string {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new BadRequestException(
      `${fieldName} must be a valid YYYY-MM-DD value`,
    );
  }

  const parsed = DateTime.fromISO(value, { zone: 'UTC' });
  if (!parsed.isValid || parsed.toISODate() !== value) {
    throw new BadRequestException(
      `${fieldName} must be a valid YYYY-MM-DD value`,
    );
  }

  return value;
}

export function parseIsoOrPtBrLocalDate(value: string): string | undefined {
  const normalized = value.trim();
  const parsed = DATE_ONLY_PATTERN.test(normalized)
    ? DateTime.fromISO(normalized, { zone: 'UTC' })
    : PT_BR_DATE_ONLY_PATTERN.test(normalized)
      ? DateTime.fromFormat(normalized, 'd/M/yyyy', {
          zone: 'UTC',
          locale: 'pt-BR',
        })
      : undefined;
  if (!parsed?.isValid) return undefined;
  return parsed.toISODate() ?? undefined;
}

export function localDateRangeToUtc(
  date: string,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): { startUtc: Date; endUtc: Date } {
  const localDate = parseLocalDate(date);
  const start = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  assertValidTimezone(start, timezone);

  return {
    startUtc: start.toUTC().toJSDate(),
    endUtc: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

export function localDateTimeToUtc(
  date: string,
  time: string,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): Date {
  const localDate = parseLocalDate(date);
  const parsed = DateTime.fromISO(`${localDate}T${time}`, { zone: timezone });
  assertValidTimezone(parsed, timezone);
  if (!parsed.isValid) {
    throw new BadRequestException('local datetime must be valid');
  }
  return parsed.toUTC().toJSDate();
}

export function formatDateInTimezone(
  date: Date,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('dd/LL/yyyy');
}

export function formatTimeInTimezone(
  date: Date,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('HH:mm');
}

export function formatLocalDate(
  date: Date,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  return DateTime.fromJSDate(date).setZone(timezone).toISODate()!;
}

export function currentLocalDate(
  now = new Date(),
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  const parsed = DateTime.fromJSDate(now).setZone(timezone);
  assertValidTimezone(parsed, timezone);
  return parsed.toISODate()!;
}

export function parseNaturalLocalDatePtBr(
  text: string,
  referenceAt: string | Date = new Date(),
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string | undefined {
  const normalized = normalizeNaturalDateText(text);
  if (!normalized) return undefined;

  const zone = validTimezoneOrDefault(timezone);
  const reference = referenceDateTime(referenceAt, zone);

  if (/\bhoje\b/.test(normalized)) return reference.toISODate()!;
  if (/\bamanha\b/.test(normalized)) {
    return reference.plus({ days: 1 }).toISODate()!;
  }

  const iso = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) {
    return DateTime.fromISO(iso, { zone: 'UTC' }).isValid ? iso : undefined;
  }

  const br = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) {
    const year = br[3]
      ? br[3].length === 2
        ? `20${br[3]}`
        : br[3]
      : String(reference.year);
    const parsed = DateTime.fromObject(
      {
        year: Number(year),
        month: Number(br[2]),
        day: Number(br[1]),
      },
      { zone },
    );
    return parsed.isValid ? parsed.toISODate() : undefined;
  }

  if (/\bfim de semana\b/.test(normalized)) {
    return nextWeekday(reference, 6);
  }

  for (const [weekdayText, weekday] of Object.entries(WEEKDAYS_PT_BR)) {
    if (new RegExp(`\\b(?:proxima\\s+)?${weekdayText}\\b`).test(normalized)) {
      return nextWeekday(reference, weekday);
    }
  }

  return undefined;
}

/**
 * Parses only time syntax after the conversational layer has established that
 * the text belongs to a temporal slot. It deliberately does not infer intent.
 */
export function parseNaturalLocalTimePtBr(text: string): string | undefined {
  const normalized = normalizeNaturalDateText(text);
  const match = normalized.match(
    /\b(?:as\s+)?([01]?\d|2[0-3])(?:(?::|h)([0-5]\d))?\s*h?\b/,
  );
  if (!match) return undefined;
  return `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`;
}

export function addLocalDays(
  date: string,
  days: number,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  const parsed = DateTime.fromISO(parseLocalDate(date), { zone: timezone });
  assertValidTimezone(parsed, timezone);
  return parsed.plus({ days }).toISODate()!;
}

export function startOfLocalMonth(
  date: string,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  const parsed = DateTime.fromISO(parseLocalDate(date), { zone: timezone });
  assertValidTimezone(parsed, timezone);
  return parsed.startOf('month').toISODate()!;
}

export function endOfLocalMonth(
  date: string,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  const parsed = DateTime.fromISO(parseLocalDate(date), { zone: timezone });
  assertValidTimezone(parsed, timezone);
  return parsed.endOf('month').toISODate()!;
}

export function addLocalMonths(
  date: string,
  months: number,
  timezone = DEFAULT_ESTABLISHMENT_TIMEZONE,
): string {
  const parsed = DateTime.fromISO(parseLocalDate(date), { zone: timezone });
  assertValidTimezone(parsed, timezone);
  return parsed.plus({ months }).toISODate()!;
}

function assertValidTimezone(value: DateTime, timezone: string): void {
  if (!value.isValid) {
    throw new BadRequestException(`timezone "${timezone}" is invalid`);
  }
}

function normalizeNaturalDateText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function validTimezoneOrDefault(timezone?: string): string {
  if (!timezone) return DEFAULT_ESTABLISHMENT_TIMEZONE;
  const probe = DateTime.now().setZone(timezone);
  return probe.isValid ? timezone : DEFAULT_ESTABLISHMENT_TIMEZONE;
}

function referenceDateTime(referenceAt: string | Date, timezone: string) {
  const parsed =
    referenceAt instanceof Date
      ? DateTime.fromJSDate(referenceAt).setZone(timezone)
      : DateTime.fromISO(referenceAt, { setZone: true }).setZone(timezone);
  return parsed.isValid
    ? parsed.startOf('day')
    : DateTime.now().setZone(timezone).startOf('day');
}

function nextWeekday(reference: DateTime, weekday: number): string {
  let days = weekday - reference.weekday;
  if (days <= 0) days += 7;
  return reference.plus({ days }).toISODate()!;
}
