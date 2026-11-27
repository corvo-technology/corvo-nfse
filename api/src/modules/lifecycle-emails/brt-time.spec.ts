import { brtDayStart, brtMonthWindow } from './brt-time';

describe('brt time', () => {
  it('starts the day at 03:00 UTC', () => {
    expect(brtDayStart(new Date('2026-11-05T10:00:00Z')).toISOString()).toBe(
      '2026-11-05T03:00:00.000Z',
    );
  });

  it('keeps the previous day until 03:00 UTC', () => {
    expect(brtDayStart(new Date('2026-11-05T02:59:00Z')).toISOString()).toBe(
      '2026-11-04T03:00:00.000Z',
    );
  });

  it('gives the month as São Paulo sees it', () => {
    const { start, end } = brtMonthWindow('2026-10');
    expect(start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('rolls over the year', () => {
    expect(brtMonthWindow('2026-12').end.toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    );
  });
});
