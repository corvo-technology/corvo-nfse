import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import { InvoiceSchedule } from '../domain/invoice-schedule';
import {
  InvoiceScheduleRepository,
  type NewScheduleRun,
} from '../domain/invoice-schedule.repository';
import { ScheduleRunner } from './schedule-runner.service';
import { captureRuntimeException } from '@/infra/observability/sentry-reporter';

jest.mock('@/infra/observability/sentry-reporter', () => ({
  captureRuntimeException: jest.fn(),
}));

const NOW = new Date('2026-11-06T15:00:00Z'); // Friday, São Paulo

function schedule(
  over: Partial<{
    tenantId: string;
    environment: 'test' | 'live';
    kind: 'once' | 'recurring';
    firstOn: string;
    endsOn: string | null;
    companyId: string;
  }> = {},
): InvoiceSchedule {
  const kind = over.kind ?? 'recurring';
  return InvoiceSchedule.create(
    {
      tenantId: over.tenantId ?? '11111111-1111-4111-8111-111111111111',
      environment: over.environment ?? 'live',
      companyId: over.companyId ?? 'c1',
      kind,
      frequency: kind === 'recurring' ? 'WEEKLY' : null,
      firstOn: over.firstOn ?? '2026-11-09',
      endsOn: over.endsOn ?? null,
      invoiceInput: { companyId: over.companyId ?? 'c1', amount: 100 },
      createdBy: null,
    },
    NOW,
    15,
  );
}

class MemoryRepo extends InvoiceScheduleRepository {
  rows = new Map<string, InvoiceSchedule>();
  runs: NewScheduleRun[] = [];
  saves = 0;
  insert(s: InvoiceSchedule) {
    this.rows.set(s.props.id, s);
    return Promise.resolve();
  }
  findById() {
    return Promise.resolve(null);
  }
  list() {
    return Promise.resolve({ items: [], total: 0 });
  }
  save(s: InvoiceSchedule) {
    this.saves += 1;
    this.rows.set(s.props.id, s);
    return Promise.resolve();
  }
  countActive() {
    return Promise.resolve(0);
  }
  private due(today: string) {
    return [...this.rows.values()].filter(
      (s) => s.props.status === 'active' && (s.props.nextRunOn ?? '') <= today,
    );
  }
  listDueTenantIds(today: string, limit: number, after?: string) {
    const ids = [...new Set(this.due(today).map((s) => s.props.tenantId))]
      .sort()
      .filter((id) => !after || id > after);
    return Promise.resolve(ids.slice(0, limit));
  }
  claimDueForTenant(tenantId: string, today: string) {
    return Promise.resolve(
      this.due(today)
        .filter((s) => s.props.tenantId === tenantId)
        .sort((a, b) =>
          (a.props.nextRunOn ?? '').localeCompare(b.props.nextRunOn ?? ''),
        ),
    );
  }
  addRun(run: NewScheduleRun) {
    this.runs.push(run);
    return Promise.resolve();
  }
  nextAttempt(scheduleId: string, _tenantId: string, occurrenceOn: string) {
    const attempts = this.runs
      .filter(
        (r) => r.scheduleId === scheduleId && r.occurrenceOn === occurrenceOn,
      )
      .map((r) => r.attempt);
    return Promise.resolve(Math.max(0, ...attempts) + 1);
  }
  attemptQueries = 0;
  insertStatements = 0;
  async nextAttempts(
    tenantId: string,
    items: Array<{ scheduleId: string; occurrenceOn: string }>,
  ) {
    this.attemptQueries += 1;
    const next = new Map<string, number>();
    for (const { scheduleId, occurrenceOn } of items)
      next.set(
        `${scheduleId}:${occurrenceOn}`,
        await this.nextAttempt(scheduleId, tenantId, occurrenceOn),
      );
    return next;
  }
  addRuns(_tenantId: string, runs: NewScheduleRun[]) {
    this.insertStatements += 1;
    this.runs.push(...runs);
    return Promise.resolve();
  }
  listRuns() {
    return Promise.resolve({ items: [], total: 0 });
  }
}

type Prepare = (
  dto: Record<string, unknown>,
  tenantId: string,
  environment: string,
  key: string,
) => Promise<unknown>;

function build(
  options: {
    prepare?: Prepare;
    submit?: (entries: { invoice: { id: string } }[]) => unknown[];
    existingByKey?: unknown;
    notifierError?: boolean;
    pageSize?: number;
  } = {},
) {
  const repo = new MemoryRepo();
  const state = { inTx: false, seenInTx: [] as boolean[] };
  const prepare = jest.fn<Promise<unknown>, Parameters<Prepare>>(
    options.prepare ??
      ((dto, _tenant, _env, key) =>
        Promise.resolve({
          kind: 'ready',
          invoice: { id: `inv:${key}`, companyId: dto.companyId },
          event: {},
          requestHash: 'h',
        })),
  );
  const submitBatch = jest.fn(
    (_tenant: string, entries: { invoice: { id: string } }[]) => {
      state.seenInTx.push(state.inTx);
      return Promise.resolve(
        options.submit
          ? options.submit(entries)
          : entries.map(() => ({ ok: true })),
      );
    },
  );
  const notifier = {
    retryNotice: jest.fn(() =>
      options.notifierError
        ? Promise.reject(new Error('smtp down'))
        : Promise.resolve(),
    ),
    paused: jest.fn(() =>
      options.notifierError
        ? Promise.reject(new Error('smtp down'))
        : Promise.resolve(),
    ),
  };
  const findByIdempotencyKey = jest.fn(() =>
    Promise.resolve(options.existingByKey ?? null),
  );
  const unitOfWork = {
    execute: async <T>(work: () => Promise<T>): Promise<T> => {
      state.inTx = true;
      try {
        return await work();
      } finally {
        state.inTx = false;
      }
    },
  };
  const runner = new ScheduleRunner(
    repo,
    { prepareEmissionInEnvironment: prepare } as never,
    { submitBatch } as never,
    { findByIdempotencyKey } as never,
    unitOfWork,
    notifier,
    options.pageSize ?? 500,
  );
  return {
    runner,
    repo,
    prepare,
    submitBatch,
    notifier,
    state,
    findByIdempotencyKey,
  };
}

const key = (s: InvoiceSchedule, occurrence: string) =>
  `schedule:${s.props.id}:${occurrence}`;
const noCredit = [
  { ok: false, code: 'ERROR_QUOTA_EXCEEDED', message: 'no credits' },
];

describe('ScheduleRunner.runDue: the happy path', () => {
  it('issues the due schedule as a note: today as competence, the occurrence key, and the run is logged', async () => {
    const { runner, repo, prepare } = build();
    const s = schedule();
    await repo.insert(s);
    const result = await runner.runDue('2026-11-09');
    expect(result).toMatchObject({ issued: 1, failed: 0, paused: 0 });
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ competenceDate: '2026-11-09', amount: 100 }),
      '11111111-1111-4111-8111-111111111111',
      'live',
      key(s, '2026-11-09'),
    );
    expect(repo.runs).toEqual([
      expect.objectContaining({
        scheduleId: s.props.id,
        occurrenceOn: '2026-11-09',
        ranOn: '2026-11-09',
        attempt: 1,
        outcome: 'issued',
        invoiceId: `inv:${key(s, '2026-11-09')}`,
      }),
    ]);
    expect(s.props).toMatchObject({ nextRunOn: '2026-11-16', attempts: 0 });
  });

  it('logs the runs of many schedules with one attempt query and one insert', async () => {
    const { runner, repo } = build();
    for (let i = 0; i < 25; i += 1) await repo.insert(schedule());
    const result = await runner.runDue('2026-11-09');
    expect(result.issued).toBe(25);
    expect(repo.runs).toHaveLength(25);
    expect(repo.attemptQueries).toBe(1);
    expect(repo.insertStatements).toBe(1);
  });

  it('a single schedule completes after its run', async () => {
    const { runner, repo } = build();
    const s = schedule({ kind: 'once' });
    await repo.insert(s);
    await runner.runDue('2026-11-09');
    expect(s.props).toMatchObject({ status: 'completed', nextRunOn: null });
  });

  it('a Saturday occurrence runs on Monday with Monday as competence', async () => {
    const { runner, repo, prepare } = build();
    const s = schedule({ firstOn: '2026-11-14' });
    await repo.insert(s);
    await runner.runDue('2026-11-16');
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ competenceDate: '2026-11-16' }),
      '11111111-1111-4111-8111-111111111111',
      'live',
      key(s, '2026-11-14'),
    );
    expect(repo.runs[0]).toMatchObject({
      occurrenceOn: '2026-11-14',
      ranOn: '2026-11-16',
    });
    expect(s.props.nextRunOn).toBe('2026-11-21');
  });

  it('a long delay still yields one note, and the next date is the first one after today', async () => {
    const { runner, repo, prepare } = build();
    const s = schedule();
    await repo.insert(s);
    await runner.runDue('2026-11-30');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(s.props.nextRunOn).toBe('2026-12-07');
  });

  it('nothing due: nothing happens', async () => {
    const { runner, repo, prepare } = build();
    await repo.insert(schedule({ firstOn: '2026-11-20' }));
    expect(await runner.runDue('2026-11-09')).toMatchObject({
      issued: 0,
      failed: 0,
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('ScheduleRunner.runDue: failures', () => {
  it('failure 1 and 2 keep it active and warn; the third pauses it and sends the pause e-mail instead', async () => {
    const { runner, repo, notifier } = build({ submit: () => noCredit });
    const s = schedule();
    await repo.insert(s);

    await runner.runDue('2026-11-09');
    expect(s.props).toMatchObject({ status: 'active', attempts: 1 });
    expect(notifier.retryNotice).toHaveBeenCalledTimes(1);

    await runner.runDue('2026-11-10');
    expect(s.props).toMatchObject({ status: 'active', attempts: 2 });
    expect(notifier.retryNotice).toHaveBeenCalledTimes(2);

    const third = await runner.runDue('2026-11-11');
    expect(third.paused).toBe(1);
    expect(s.props).toMatchObject({
      status: 'paused',
      pauseReason: 'failures',
    });
    expect(notifier.retryNotice).toHaveBeenCalledTimes(2);
    expect(notifier.paused).toHaveBeenCalledTimes(1);
    expect(
      repo.runs.map((r) => [r.attempt, r.outcome, r.occurrenceOn]),
    ).toEqual([
      [1, 'failed', '2026-11-09'],
      [2, 'failed', '2026-11-09'],
      [3, 'failed', '2026-11-09'],
    ]);
    expect(repo.runs[0]).toMatchObject({
      errorCode: 'ERROR_QUOTA_EXCEEDED',
      errorMessage: 'no credits',
    });
  });

  it('review focus: when credit runs out mid-batch the oldest schedules issue and the rest fail', async () => {
    const { runner, repo, submitBatch } = build({
      submit: () => [{ ok: true }, { ok: true }, ...noCredit],
    });
    const a = schedule({ firstOn: '2026-11-09' });
    const b = schedule({ firstOn: '2026-11-10' });
    const c = schedule({ firstOn: '2026-11-11' });
    for (const s of [c, a, b]) await repo.insert(s);
    const result = await runner.runDue('2026-11-11');
    expect(result).toMatchObject({ issued: 2, failed: 1 });
    const entries = submitBatch.mock.calls[0]?.[1] ?? [];
    expect(entries.map((e) => e.invoice.id)).toEqual([
      `inv:${key(a, '2026-11-09')}`,
      `inv:${key(b, '2026-11-10')}`,
      `inv:${key(c, '2026-11-11')}`,
    ]);
    expect(a.props.attempts).toBe(0);
    expect(b.props.attempts).toBe(0);
    expect(c.props.attempts).toBe(1);
  });

  it('one warning per tenant per run lists all of its failed schedules; each tenant gets its own', async () => {
    const { runner, repo, notifier } = build({
      submit: (entries) => entries.map(() => noCredit[0]),
    });
    for (const s of [
      schedule({ tenantId: '11111111-1111-4111-8111-111111111111' }),
      schedule({ tenantId: '11111111-1111-4111-8111-111111111111' }),
      schedule({ tenantId: '22222222-2222-4222-8222-222222222222' }),
    ])
      await repo.insert(s);
    await runner.runDue('2026-11-09');
    expect(notifier.retryNotice).toHaveBeenCalledTimes(2);
    const sizes = notifier.retryNotice.mock.calls
      .map((call) => (call as unknown as [string, unknown[]])[1].length)
      .sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('a body the validation now refuses is a failed attempt and never reaches the batch', async () => {
    const { runner, repo, submitBatch } = build({
      prepare: () => Promise.reject(new FiscalValidationError([])),
    });
    await repo.insert(schedule());
    const result = await runner.runDue('2026-11-09');
    expect(result).toMatchObject({ issued: 0, failed: 1 });
    expect(submitBatch).not.toHaveBeenCalled();
    expect(repo.runs[0]).toMatchObject({ outcome: 'failed' });
    expect(repo.runs[0]?.errorCode).toBeTruthy();
  });

  it('the test environment logs the failure but never e-mails anyone', async () => {
    const { runner, repo, notifier } = build({ submit: () => noCredit });
    await repo.insert(schedule({ environment: 'test' }));
    await runner.runDue('2026-11-09');
    expect(repo.runs).toHaveLength(1);
    expect(notifier.retryNotice).not.toHaveBeenCalled();
    expect(notifier.paused).not.toHaveBeenCalled();
  });

  it('a failing notifier never undoes the run', async () => {
    const { runner, repo } = build({
      submit: () => noCredit,
      notifierError: true,
    });
    const s = schedule();
    await repo.insert(s);
    await expect(runner.runDue('2026-11-09')).resolves.toMatchObject({
      failed: 1,
    });
    expect(s.props.attempts).toBe(1);
  });
});

describe('ScheduleRunner.runDue: idempotency, state and isolation', () => {
  it('a replay of the same request counts as issued, pointing to the existing note', async () => {
    const { runner, repo, submitBatch } = build({
      prepare: () =>
        Promise.resolve({ kind: 'replay', invoice: { id: 'inv-existing' } }),
    });
    const s = schedule();
    await repo.insert(s);
    const result = await runner.runDue('2026-11-09');
    expect(result.issued).toBe(1);
    expect(submitBatch).not.toHaveBeenCalled();
    expect(repo.runs[0]).toMatchObject({
      outcome: 'issued',
      invoiceId: 'inv-existing',
    });
    expect(s.props.nextRunOn).toBe('2026-11-16');
  });

  it('review focus: a key already used on an earlier day (same occurrence) is treated as the note that was created', async () => {
    const { runner, repo, findByIdempotencyKey } = build({
      prepare: () => Promise.reject(new IdempotencyConflictError('k')),
      existingByKey: { id: 'inv-created-yesterday' },
    });
    const s = schedule();
    await repo.insert(s);
    await runner.runDue('2026-11-10');
    expect(findByIdempotencyKey).toHaveBeenCalledWith(
      key(s, '2026-11-09'),
      '11111111-1111-4111-8111-111111111111',
      'live',
    );
    expect(repo.runs[0]).toMatchObject({
      outcome: 'issued',
      invoiceId: 'inv-created-yesterday',
    });
    expect(s.props.nextRunOn).toBe('2026-11-16');
  });

  it('a conflict reported by the batch itself is handled the same way', async () => {
    const { runner, repo } = build({
      submit: () => [
        { ok: false, code: 'ERROR_IDEMPOTENCY_CONFLICT', message: 'x' },
      ],
      existingByKey: { id: 'inv-created-yesterday' },
    });
    await repo.insert(schedule());
    const result = await runner.runDue('2026-11-10');
    expect(result.issued).toBe(1);
  });

  it('a schedule that is no longer active is skipped even if the claim returned it', async () => {
    const { runner, repo, prepare } = build();
    const s = schedule();
    await repo.insert(s);
    s.pause();
    jest.spyOn(repo, 'claimDueForTenant').mockResolvedValue([s]);
    await runner.runDue('2026-11-09');
    expect(prepare).not.toHaveBeenCalled();
    expect(repo.runs).toHaveLength(0);
  });

  it('claim, batch and saves happen inside one transaction; e-mails go out after it', async () => {
    const { runner, repo, state, notifier } = build({ submit: () => noCredit });
    await repo.insert(schedule());
    const saveInTx: boolean[] = [];
    jest.spyOn(repo, 'save').mockImplementation((s: InvoiceSchedule) => {
      saveInTx.push(state.inTx);
      repo.rows.set(s.props.id, s);
      return Promise.resolve();
    });
    const noticeInTx: boolean[] = [];
    notifier.retryNotice.mockImplementation(() => {
      noticeInTx.push(state.inTx);
      return Promise.resolve();
    });
    await runner.runDue('2026-11-09');
    expect(state.seenInTx).toEqual([true]);
    expect(saveInTx).toEqual([true]);
    expect(noticeInTx).toEqual([false]);
  });

  it('an unexpected error rolls the tenant back (nothing saved) and the other tenants still run', async () => {
    const { runner, repo } = build({
      prepare: (dto, tenant, _env, key) =>
        tenant === '11111111-1111-4111-8111-111111111111'
          ? Promise.reject(new Error('db down'))
          : Promise.resolve({
              kind: 'ready',
              invoice: { id: `inv:${key}`, companyId: dto.companyId },
              event: {},
              requestHash: 'h',
            }),
    });
    const bad = schedule({ tenantId: '11111111-1111-4111-8111-111111111111' });
    const good = schedule({ tenantId: '22222222-2222-4222-8222-222222222222' });
    await repo.insert(bad);
    await repo.insert(good);
    const result = await runner.runDue('2026-11-09');
    expect(result).toMatchObject({ issued: 1, errors: 1 });
    expect(bad.props).toMatchObject({ attempts: 0, nextRunOn: '2026-11-09' });
    expect(
      repo.runs.every(
        (r) => r.tenantId === '22222222-2222-4222-8222-222222222222',
      ),
    ).toBe(true);
  });

  it('visits every due tenant once even when pages are smaller than the list and failed ones stay due', async () => {
    const { runner, repo, prepare } = build({
      submit: (entries) => entries.map(() => noCredit[0]),
      pageSize: 2,
    });
    for (const tenantId of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ])
      await repo.insert(schedule({ tenantId }));
    await runner.runDue('2026-11-09');
    expect(prepare).toHaveBeenCalledTimes(5);
  });

  it('review: the attempt number continues from the log, even when the counter was reset (pause and resume the same day)', async () => {
    const { runner, repo } = build({ submit: () => noCredit });
    const s = schedule({ kind: 'once' });
    await repo.insert(s);
    await repo.addRun({
      tenantId: s.props.tenantId,
      scheduleId: s.props.id,
      occurrenceOn: '2026-11-09',
      ranOn: '2026-11-09',
      attempt: 1,
      outcome: 'failed',
      invoiceId: null,
      errorCode: 'x',
      errorMessage: 'x',
    });
    expect(s.props.attempts).toBe(0);
    const result = await runner.runDue('2026-11-10');
    expect(result.errors).toBe(0);
    expect(repo.runs.map((r) => r.attempt)).toEqual([1, 2]);
  });

  it('review: an unexpected error is reported to Sentry, not only logged', async () => {
    const { runner, repo } = build({
      prepare: () => Promise.reject(new Error('db down')),
    });
    await repo.insert(schedule());
    await runner.runDue('2026-11-09');
    expect(captureRuntimeException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'db down' }),
      'api',
      'invoice_schedule_tenant_run',
    );
  });
});
