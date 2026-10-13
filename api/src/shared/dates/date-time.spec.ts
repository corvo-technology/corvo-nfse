import {
  formatTimeInTimezone,
  localDateRangeToUtc,
  parseNaturalLocalDatePtBr,
  parseNaturalLocalTimePtBr,
  parseInstantWithOffset,
  parseIsoOrPtBrLocalDate,
  parseLocalDate,
} from './date-time';

describe('date-time helpers', () => {
  it('rejects datetimes without an explicit offset', () => {
    expect(() =>
      parseInstantWithOffset('2026-06-15T08:15:00', 'startAt'),
    ).toThrow('startAt must include Z or UTC offset');
  });

  it('parses offset datetimes as UTC instants', () => {
    expect(
      parseInstantWithOffset('2026-06-15T08:15:00-03:00').toISOString(),
    ).toBe('2026-06-15T11:15:00.000Z');
  });

  it('validates real local dates only', () => {
    expect(parseLocalDate('2026-06-15')).toBe('2026-06-15');
    expect(() => parseLocalDate('2026-02-30')).toThrow(
      'date must be a valid YYYY-MM-DD value',
    );
  });

  it('normalizes ISO and Brazilian local dates without swapping day and month', () => {
    expect(parseIsoOrPtBrLocalDate('1983-07-06')).toBe('1983-07-06');
    expect(parseIsoOrPtBrLocalDate('24/08/1969')).toBe('1969-08-24');
    expect(parseIsoOrPtBrLocalDate('7/6/1983')).toBe('1983-06-07');
    expect(parseIsoOrPtBrLocalDate('07/06/1983')).toBe('1983-06-07');
    expect(parseIsoOrPtBrLocalDate('29/02/2024')).toBe('2024-02-29');
  });

  it('rejects unsupported or impossible imported local dates', () => {
    expect(parseIsoOrPtBrLocalDate('29/02/2023')).toBeUndefined();
    expect(parseIsoOrPtBrLocalDate('2023-02-29')).toBeUndefined();
    expect(parseIsoOrPtBrLocalDate('31/04/2020')).toBeUndefined();
    expect(parseIsoOrPtBrLocalDate('08-24-1969')).toBeUndefined();
  });

  it('converts an establishment local day to a UTC range', () => {
    const range = localDateRangeToUtc('2026-06-15', 'America/Sao_Paulo');

    expect(range.startUtc.toISOString()).toBe('2026-06-15T03:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-06-16T03:00:00.000Z');
  });

  it('formats time in an explicit timezone', () => {
    expect(
      formatTimeInTimezone(
        new Date('2026-06-15T11:15:00.000Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('08:15');
  });

  it('parses PT-BR natural local dates deterministically', () => {
    const reference = '2026-06-26T12:00:00.000-03:00';

    expect(parseNaturalLocalDatePtBr('hoje', reference)).toBe('2026-06-26');
    expect(parseNaturalLocalDatePtBr('amanhã', reference)).toBe('2026-06-27');
    expect(parseNaturalLocalDatePtBr('segunda', reference)).toBe('2026-06-29');
    expect(parseNaturalLocalDatePtBr('próxima segunda', reference)).toBe(
      '2026-06-29',
    );
    expect(parseNaturalLocalDatePtBr('fim de semana', reference)).toBe(
      '2026-06-27',
    );
    expect(parseNaturalLocalDatePtBr('29/06', reference)).toBe('2026-06-29');
    expect(parseNaturalLocalDatePtBr('2026-06-29', reference)).toBe(
      '2026-06-29',
    );
  });

  it('resolves weekdays to the next future occurrence', () => {
    expect(
      parseNaturalLocalDatePtBr('segunda', '2026-06-29T12:00:00.000-03:00'),
    ).toBe('2026-07-06');
  });

  it('normalizes PT-BR time syntax without inferring conversational intent', () => {
    expect(parseNaturalLocalTimePtBr('às 18h')).toBe('18:00');
    expect(parseNaturalLocalTimePtBr('as 14')).toBe('14:00');
    expect(parseNaturalLocalTimePtBr('18:30')).toBe('18:30');
    expect(parseNaturalLocalTimePtBr('às 7h05')).toBe('07:05');
    expect(parseNaturalLocalTimePtBr('segunda-feira')).toBeUndefined();
  });
});
