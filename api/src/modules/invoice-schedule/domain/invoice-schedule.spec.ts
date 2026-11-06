import {
  InvoiceSchedule,
  ScheduleStateError,
  ScheduleValidationError,
} from './invoice-schedule';

const NOW = new Date('2026-11-06T15:00:00Z'); // Friday 12:00 in São Paulo
const base = {
  tenantId: 't1',
  environment: 'live' as const,
  companyId: 'c1',
  invoiceInput: { amount: 100 },
  createdBy: 'u1',
};
const recurring = (over: Record<string, unknown> = {}) =>
  InvoiceSchedule.create(
    {
      ...base,
      kind: 'recurring',
      frequency: 'WEEKLY',
      firstOn: '2026-11-09',
      endsOn: null,
      ...over,
    } as never,
    NOW,
    15,
  );
const once = (firstOn = '2026-11-09') =>
  InvoiceSchedule.create(
    { ...base, kind: 'once', frequency: null, firstOn, endsOn: null },
    NOW,
    15,
  );

describe('InvoiceSchedule.create', () => {
  it('starts active, with the first date pending and no attempts', () => {
    const s = recurring();
    expect(s.props).toMatchObject({
      status: 'active',
      kind: 'recurring',
      frequency: 'WEEKLY',
      anchorOn: '2026-11-09',
      nextRunOn: '2026-11-09',
      occurrenceIndex: 0,
      attempts: 0,
      pauseReason: null,
    });
  });

  it.each([
    ['today', '2026-11-06', 'first_date_too_soon'],
    ['the past', '2026-11-01', 'first_date_too_soon'],
    ['beyond the horizon', '2026-11-22', 'schedule_horizon_exceeded'],
  ])('rejects a first date %s', (_label, firstOn, code) => {
    expect(() => once(firstOn)).toThrow(ScheduleValidationError);
    try {
      once(firstOn);
    } catch (error) {
      expect((error as ScheduleValidationError).code).toBe(code);
    }
  });

  it('accepts tomorrow and the last day of the horizon', () => {
    expect(once('2026-11-07').props.nextRunOn).toBe('2026-11-07');
    expect(once('2026-11-21').props.nextRunOn).toBe('2026-11-21');
  });

  it('a recurring schedule needs a frequency, a single one must not have it', () => {
    expect(() => recurring({ frequency: null })).toThrow(
      ScheduleValidationError,
    );
    expect(() =>
      InvoiceSchedule.create(
        {
          ...base,
          kind: 'once',
          frequency: 'WEEKLY',
          firstOn: '2026-11-09',
          endsOn: null,
        },
        NOW,
        15,
      ),
    ).toThrow(ScheduleValidationError);
  });

  it('endsOn must be after the first date', () => {
    expect(() => recurring({ endsOn: '2026-11-09' })).toThrow(
      ScheduleValidationError,
    );
    expect(recurring({ endsOn: '2026-12-31' }).props.endsOn).toBe('2026-12-31');
  });
});

describe('recordIssued', () => {
  it('a single schedule completes', () => {
    const s = once();
    s.recordIssued('2026-11-09');
    expect(s.props).toMatchObject({
      status: 'completed',
      nextRunOn: null,
      lastRunOn: '2026-11-09',
    });
  });

  it('weekly: the next occurrence is the following week, attempts reset', () => {
    const s = recurring();
    s.recordFailure('2026-11-09');
    s.recordIssued('2026-11-10');
    expect(s.props).toMatchObject({
      status: 'active',
      attempts: 0,
      nextRunOn: '2026-11-16',
      occurrenceIndex: 1,
    });
  });

  it('a Saturday occurrence processed on Monday moves on to the next Saturday', () => {
    const s = recurring({ firstOn: '2026-11-14' });
    s.recordIssued('2026-11-16');
    expect(s.props.nextRunOn).toBe('2026-11-21');
  });

  it('completes when the next occurrence passes the deadline', () => {
    const s = recurring({ endsOn: '2026-11-15' });
    s.recordIssued('2026-11-09');
    expect(s.props).toMatchObject({ status: 'completed', nextRunOn: null });
  });
});

describe('recordFailure', () => {
  it('the first two failures keep it active, the third pauses it', () => {
    const s = recurring();
    expect(s.recordFailure('2026-11-09')).toEqual({ paused: false });
    expect(s.recordFailure('2026-11-10')).toEqual({ paused: false });
    expect(s.props).toMatchObject({ status: 'active', attempts: 2 });
    expect(s.props.nextRunOn).toBe('2026-11-09'); // still due: retried next business day
    expect(s.recordFailure('2026-11-11')).toEqual({ paused: true });
    expect(s.props).toMatchObject({
      status: 'paused',
      pauseReason: 'failures',
      nextRunOn: null,
      attempts: 3,
    });
  });
});

describe('pause, resume, cancel', () => {
  it('pause marks the customer as the reason', () => {
    const s = recurring();
    s.pause();
    expect(s.props).toMatchObject({
      status: 'paused',
      pauseReason: 'customer',
      nextRunOn: null,
    });
  });

  it('resume goes to the first occurrence after today and does not back-fill', () => {
    const s = recurring();
    s.recordFailure('2026-11-09');
    s.recordFailure('2026-11-10');
    s.recordFailure('2026-11-11');
    s.resume('2026-11-25');
    expect(s.props).toMatchObject({
      status: 'active',
      attempts: 0,
      pauseReason: null,
      nextRunOn: '2026-11-30',
    });
  });

  it('resuming a single schedule makes it due again at the next run', () => {
    const s = once();
    s.pause();
    s.resume('2026-11-12');
    expect(s.props).toMatchObject({
      status: 'active',
      nextRunOn: '2026-11-12',
    });
  });

  it('cancel is final: no update, resume or pause afterwards', () => {
    const s = recurring();
    s.cancel();
    expect(s.props.status).toBe('cancelled');
    expect(() => s.resume('2026-11-10')).toThrow(ScheduleStateError);
    expect(() => s.pause()).toThrow(ScheduleStateError);
    expect(() => s.update({ invoiceInput: {} }, '2026-11-10')).toThrow(
      ScheduleStateError,
    );
  });

  it('a completed schedule cannot be changed either', () => {
    const s = once();
    s.recordIssued('2026-11-09');
    expect(() => s.update({ invoiceInput: {} }, '2026-11-10')).toThrow(
      ScheduleStateError,
    );
    expect(() => s.cancel()).toThrow(ScheduleStateError);
  });

  it('only an active schedule can be paused, only a paused one resumed', () => {
    const s = recurring();
    expect(() => s.resume('2026-11-10')).toThrow(ScheduleStateError);
    s.pause();
    expect(() => s.pause()).toThrow(ScheduleStateError);
  });
});

describe('update', () => {
  it('changing only the invoice data leaves the dates alone', () => {
    const s = recurring();
    s.recordFailure('2026-11-09');
    s.update({ invoiceInput: { amount: 250 } }, '2026-11-10');
    expect(s.props.invoiceInput).toEqual({ amount: 250 });
    expect(s.props).toMatchObject({ nextRunOn: '2026-11-09', attempts: 1 });
  });

  it('changing the frequency recomputes the next date and resets attempts', () => {
    const s = recurring();
    s.recordFailure('2026-11-09');
    s.update({ frequency: 'MONTHLY' }, '2026-11-10');
    expect(s.props).toMatchObject({
      frequency: 'MONTHLY',
      attempts: 0,
      nextRunOn: '2026-12-09',
    });
  });

  it('a deadline already passed by the next occurrence completes the schedule', () => {
    const s = recurring();
    s.update({ endsOn: '2026-11-09' }, '2026-11-10');
    expect(s.props.status).toBe('completed');
  });

  it('a new anchor date on a paused schedule keeps it paused', () => {
    const s = recurring();
    s.pause();
    s.update({ anchorOn: '2026-11-16' }, '2026-11-10');
    expect(s.props).toMatchObject({ status: 'paused', nextRunOn: null });
  });
});
