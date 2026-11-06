import {
  firstOccurrenceAfter,
  isBusinessDay,
  occurrenceOn,
  todayInSaoPaulo,
  tomorrowInSaoPaulo,
} from './recurrence';

describe('occurrenceOn', () => {
  it('weekly adds 7 days per index', () => {
    expect(occurrenceOn('2026-11-02', 'WEEKLY', 0)).toBe('2026-11-02');
    expect(occurrenceOn('2026-11-02', 'WEEKLY', 3)).toBe('2026-11-23');
  });

  it('biweekly adds 14 days per index', () => {
    expect(occurrenceOn('2026-11-02', 'BIWEEKLY', 2)).toBe('2026-11-30');
  });

  it('monthly keeps the day and uses the last day of shorter months without drifting', () => {
    expect(occurrenceOn('2026-01-31', 'MONTHLY', 1)).toBe('2026-02-28');
    expect(occurrenceOn('2026-01-31', 'MONTHLY', 2)).toBe('2026-03-31');
    expect(occurrenceOn('2026-01-31', 'MONTHLY', 3)).toBe('2026-04-30');
    expect(occurrenceOn('2026-01-31', 'MONTHLY', 4)).toBe('2026-05-31');
  });

  it('monthly handles leap years and year changes', () => {
    expect(occurrenceOn('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29');
    expect(occurrenceOn('2026-11-15', 'MONTHLY', 2)).toBe('2027-01-15');
  });
});

describe('firstOccurrenceAfter', () => {
  it('returns the first occurrence strictly after the given date', () => {
    expect(firstOccurrenceAfter('2026-11-07', 'WEEKLY', '2026-11-09')).toEqual({
      index: 1,
      on: '2026-11-14',
    });
  });

  it('is strictly after: an occurrence on the same day does not count', () => {
    expect(firstOccurrenceAfter('2026-11-09', 'WEEKLY', '2026-11-09')).toEqual({
      index: 1,
      on: '2026-11-16',
    });
  });

  it('a long delay yields one single next occurrence (no back-fill)', () => {
    expect(firstOccurrenceAfter('2026-11-02', 'WEEKLY', '2026-12-01')).toEqual({
      index: 5,
      on: '2026-12-07',
    });
  });

  it('works for monthly clamped days', () => {
    expect(firstOccurrenceAfter('2026-01-31', 'MONTHLY', '2026-02-28')).toEqual(
      {
        index: 2,
        on: '2026-03-31',
      },
    );
  });

  it('a date before the anchor returns the anchor itself', () => {
    expect(firstOccurrenceAfter('2026-11-20', 'WEEKLY', '2026-11-01')).toEqual({
      index: 0,
      on: '2026-11-20',
    });
  });
});

describe('Sao Paulo dates', () => {
  it('todayInSaoPaulo is still the 6th at 02:30 UTC of the 7th', () => {
    expect(todayInSaoPaulo(new Date('2026-11-07T02:30:00Z'))).toBe(
      '2026-11-06',
    );
  });

  it('tomorrowInSaoPaulo follows São Paulo, not UTC', () => {
    expect(tomorrowInSaoPaulo(new Date('2026-11-07T02:30:00Z'))).toBe(
      '2026-11-07',
    );
  });

  it('isBusinessDay is Monday to Friday', () => {
    expect(isBusinessDay('2026-11-06')).toBe(true); // Friday
    expect(isBusinessDay('2026-11-07')).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-08')).toBe(false); // Sunday
    expect(isBusinessDay('2026-11-09')).toBe(true); // Monday
  });
});
