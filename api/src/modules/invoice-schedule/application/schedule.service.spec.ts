import { BadRequestException } from '@nestjs/common';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  InvoiceSchedule,
  ScheduleStateError,
  ScheduleValidationError,
} from '../domain/invoice-schedule';
import {
  InvoiceScheduleRepository,
  type NewScheduleRun,
  type ScheduleRun,
} from '../domain/invoice-schedule.repository';
import {
  ScheduleLimitError,
  ScheduleNotFoundError,
} from '../domain/schedule-errors';
import { ScheduleService, MAX_ACTIVE_SCHEDULES } from './schedule.service';

const NOW = new Date('2026-11-06T15:00:00Z'); // Friday, São Paulo
const TENANT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '44444444-4444-4444-8444-444444444444';
const auth = (environment: 'test' | 'live' = 'live') =>
  ({
    activeTenantId: TENANT,
    authUserId: 'user-1',
    apiKeyEnvironment: environment,
  }) as never;

class MemoryRepo extends InvoiceScheduleRepository {
  rows = new Map<string, InvoiceSchedule>();
  runs: ScheduleRun[] = [];
  findByIdempotencyKey(tenantId: string, environment: string, key: string) {
    return Promise.resolve(
      [...this.rows.values()].find(
        (s) =>
          s.props.tenantId === tenantId &&
          s.props.environment === environment &&
          s.props.idempotencyKey === key,
      ) ?? null,
    );
  }
  insert(s: InvoiceSchedule) {
    this.rows.set(s.props.id, s);
    return Promise.resolve();
  }
  lockedReads: boolean[] = [];
  saveInTx: boolean[] = [];
  inTx = { value: false };
  findById(id: string, tenantId: string, options?: { forUpdate?: boolean }) {
    if (options?.forUpdate) this.lockedReads.push(this.inTx.value);
    const found = this.rows.get(id);
    return Promise.resolve(found?.props.tenantId === tenantId ? found : null);
  }
  list(tenantId: string) {
    const items = [...this.rows.values()].filter(
      (s) => s.props.tenantId === tenantId,
    );
    return Promise.resolve({ items, total: items.length });
  }
  save(s: InvoiceSchedule) {
    this.saveInTx.push(this.inTx.value);
    this.rows.set(s.props.id, s);
    return Promise.resolve();
  }
  countActive(tenantId: string) {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (s) => s.props.tenantId === tenantId && s.props.status === 'active',
      ).length,
    );
  }
  listDueTenantIds() {
    return Promise.resolve([]);
  }
  claimDueForTenant() {
    return Promise.resolve([]);
  }
  addRun(run: NewScheduleRun) {
    this.runs.push({ ...run, id: String(this.runs.length), createdAt: NOW });
    return Promise.resolve();
  }
  listRuns(scheduleId: string) {
    const items = this.runs.filter((r) => r.scheduleId === scheduleId);
    return Promise.resolve({ items, total: items.length });
  }
}

function build() {
  const repo = new MemoryRepo();
  const prepare = jest
    .fn<Promise<unknown>, [Record<string, unknown>, string, string]>()
    .mockResolvedValue({ kind: 'ready', invoice: { companyId: COMPANY } });
  const unitOfWork = {
    execute: async <T>(work: () => Promise<T>): Promise<T> => {
      repo.inTx.value = true;
      try {
        return await work();
      } finally {
        repo.inTx.value = false;
      }
    },
  };
  const service = new ScheduleService(
    repo,
    { prepareEmissionInEnvironment: prepare } as never,
    15,
    unitOfWork,
  );
  return { service, repo, prepare };
}

const body = {
  companyTaxId: '12.345.678/0001-90',
  amount: 150,
  customer: { name: 'Ana', taxId: '123.456.789-09' },
  options: { email: { send: true } },
};
const request = (options: Record<string, unknown>, over = {}) =>
  ({
    ...body,
    competenceDate: '2026-11-09',
    ...over,
    options: { ...body.options, ...options },
  }) as never;

describe('ScheduleService.createFromEmission', () => {
  it('creates a recurring schedule and keeps the invoice body without the dates', async () => {
    const { service, repo } = build();
    const created = await service.createFromEmission(
      request({
        type: 'RECURRING',
        recurrence: { frequency: 'MONTHLY', endsOn: '2027-06-30' },
      }),
      TENANT,
      auth(),
      NOW,
    );
    expect(created.props).toMatchObject({
      kind: 'recurring',
      frequency: 'MONTHLY',
      anchorOn: '2026-11-09',
      nextRunOn: '2026-11-09',
      endsOn: '2027-06-30',
      companyId: COMPANY,
      environment: 'live',
      createdBy: 'user-1',
      status: 'active',
    });
    expect(created.props.invoiceInput).toEqual({
      companyId: COMPANY,
      amount: 150,
      customer: { name: 'Ana', taxId: '123.456.789-09' },
      options: { email: { send: true } },
    });
    expect(repo.rows.size).toBe(1);
  });

  it('SCHEDULE creates a single schedule', async () => {
    const { service } = build();
    const created = await service.createFromEmission(
      request({ type: 'SCHEDULE' }),
      TENANT,
      auth(),
      NOW,
    );
    expect(created.props).toMatchObject({ kind: 'once', frequency: null });
  });

  it('validates the invoice body like a normal emission, with today as the competence', async () => {
    const { service, prepare } = build();
    await service.createFromEmission(
      request({ type: 'SCHEDULE' }),
      TENANT,
      auth('test'),
      NOW,
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ competenceDate: '2026-11-06', amount: 150 }),
      TENANT,
      'test',
    );
    const sent = prepare.mock.calls[0]?.[0];
    expect(sent?.options).toEqual({ email: { send: true } });
  });

  it('a body the fiscal validation refuses stops the creation, nothing is saved', async () => {
    const { service, repo, prepare } = build();
    prepare.mockRejectedValue(
      new FiscalValidationError([
        { field: 'amount', code: 'required', message: 'amount is required' },
      ]),
    );
    await expect(
      service.createFromEmission(
        request({ type: 'SCHEDULE' }),
        TENANT,
        auth(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(repo.rows.size).toBe(0);
  });

  it('RECURRING without a frequency is a validation error', async () => {
    const { service } = build();
    await expect(
      service.createFromEmission(
        request({ type: 'RECURRING' }),
        TENANT,
        auth(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('a recurrence on a SCHEDULE is refused', async () => {
    const { service } = build();
    await expect(
      service.createFromEmission(
        request({ type: 'SCHEDULE', recurrence: { frequency: 'WEEKLY' } }),
        TENANT,
        auth(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('refuses the 201st active schedule of a tenant', async () => {
    const { service, repo } = build();
    jest.spyOn(repo, 'countActive').mockResolvedValue(MAX_ACTIVE_SCHEDULES);
    await expect(
      service.createFromEmission(
        request({ type: 'SCHEDULE' }),
        TENANT,
        auth(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(ScheduleLimitError);
  });
});

describe('ScheduleService management', () => {
  async function created() {
    const ctx = build();
    const schedule = await ctx.service.createFromEmission(
      request({ type: 'RECURRING', recurrence: { frequency: 'WEEKLY' } }),
      TENANT,
      auth(),
      NOW,
    );
    return { ...ctx, id: schedule.props.id };
  }

  it('get and runs of another tenant are not found', async () => {
    const { service, id } = await created();
    await expect(service.get(id, 'other')).rejects.toBeInstanceOf(
      ScheduleNotFoundError,
    );
    await expect(
      service.runs(id, 'other', { limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('pause, resume and cancel are persisted', async () => {
    const { service, repo, id } = await created();
    await service.pause(id, TENANT);
    expect(repo.rows.get(id)?.props).toMatchObject({
      status: 'paused',
      pauseReason: 'customer',
    });
    await service.resume(id, TENANT, NOW);
    expect(repo.rows.get(id)?.props.status).toBe('active');
    await service.cancel(id, TENANT);
    expect(repo.rows.get(id)?.props.status).toBe('cancelled');
    await expect(service.resume(id, TENANT, NOW)).rejects.toBeInstanceOf(
      ScheduleStateError,
    );
  });

  it('resuming is refused when the tenant already has the maximum of active schedules', async () => {
    const { service, repo, id } = await created();
    await service.pause(id, TENANT);
    jest.spyOn(repo, 'countActive').mockResolvedValue(MAX_ACTIVE_SCHEDULES);
    await expect(service.resume(id, TENANT, NOW)).rejects.toBeInstanceOf(
      ScheduleLimitError,
    );
  });

  it('updating the invoice data merges it, validates it again and leaves the dates alone', async () => {
    const { service, repo, prepare, id } = await created();
    prepare.mockClear();
    const updated = await service.update(
      id,
      TENANT,
      { invoice: { amount: 300 } },
      NOW,
    );
    expect(updated.props.invoiceInput).toMatchObject({
      companyId: COMPANY,
      amount: 300,
      customer: { name: 'Ana', taxId: '123.456.789-09' },
    });
    expect(updated.props.nextRunOn).toBe('2026-11-09');
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 300, competenceDate: '2026-11-06' }),
      TENANT,
      'live',
    );
    expect(repo.rows.get(id)?.props.invoiceInput).toMatchObject({
      amount: 300,
    });
  });

  it('an invalid invoice update keeps the schedule untouched', async () => {
    const { service, repo, prepare, id } = await created();
    prepare.mockRejectedValue(new FiscalValidationError([]));
    await expect(
      service.update(id, TENANT, { invoice: { amount: -1 } }, NOW),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(repo.rows.get(id)?.props.invoiceInput).toMatchObject({
      amount: 150,
    });
  });

  it('updating only the deadline or frequency does not revalidate the invoice', async () => {
    const { service, prepare, id } = await created();
    prepare.mockClear();
    const updated = await service.update(
      id,
      TENANT,
      { frequency: 'MONTHLY', endsOn: '2027-12-31' },
      NOW,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(updated.props).toMatchObject({
      frequency: 'MONTHLY',
      endsOn: '2027-12-31',
      nextRunOn: '2026-11-09', // the first date is still ahead of today
    });
  });

  it.each([
    ['companyId', { companyId: '33333333-3333-4333-8333-333333333333' }],
    ['companyTaxId', { companyTaxId: '11222333000181' }],
    ['competenceDate', { competenceDate: '2026-12-01' }],
    ['options.type', { options: { type: 'IMMEDIATE' } }],
    [
      'options.recurrence',
      { options: { recurrence: { frequency: 'WEEKLY' } } },
    ],
  ])(
    'review: the PATCH cannot change %s (what the schedule owns)',
    async (_name, invoice) => {
      const { service, prepare, id } = await created();
      prepare.mockClear();
      await expect(
        service.update(id, TENANT, { invoice }, NOW),
      ).rejects.toBeInstanceOf(ScheduleValidationError);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['customer as a string', { customer: 'x' }],
    ['amount as text', { amount: 'abc' }],
  ])(
    'review: a malformed body (%s) is a validation error, not a 500',
    async (_name, invoice) => {
      const { service, repo, prepare, id } = await created();
      prepare.mockClear();
      const error = await service
        .update(id, TENANT, { invoice }, NOW)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(prepare).not.toHaveBeenCalled();
      expect(repo.rows.get(id)?.props.invoiceInput).toMatchObject({
        amount: 150,
      });
    },
  );

  it('review: every mutation reads the row FOR UPDATE and saves inside one transaction (no lost update against the daily run)', async () => {
    const { service, repo, id } = await created();
    repo.lockedReads.length = 0;
    repo.saveInTx.length = 0;
    await service.update(id, TENANT, { endsOn: '2027-12-31' }, NOW);
    await service.pause(id, TENANT);
    await service.resume(id, TENANT, NOW);
    await service.cancel(id, TENANT);
    expect(repo.lockedReads).toEqual([true, true, true, true]);
    expect(repo.saveInTx).toEqual([true, true, true, true]);
  });
});

describe('ScheduleService.createFromEmission: idempotency (review)', () => {
  const recurringRequest = (amount = 150) =>
    request(
      { type: 'RECURRING', recurrence: { frequency: 'MONTHLY' } },
      { amount },
    );
  const create = (
    service: ScheduleService,
    key: string | undefined,
    amount = 150,
  ) =>
    service.createFromEmission(
      recurringRequest(amount),
      TENANT,
      auth(),
      NOW,
      key,
    );

  it('the same key with the same request returns the schedule already created, not a second one', async () => {
    const { service, repo } = build();
    const first = await create(service, 'key-1');
    const again = await create(service, 'key-1');
    expect(again.props.id).toBe(first.props.id);
    expect(repo.rows.size).toBe(1);
  });

  it('the same key with another request is a conflict, and nothing new is saved', async () => {
    const { service, repo } = build();
    await create(service, 'key-1', 150);
    await expect(create(service, 'key-1', 999)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(repo.rows.size).toBe(1);
  });

  it('different keys, or no key at all, create separate schedules', async () => {
    const { service, repo } = build();
    await create(service, 'key-1');
    await create(service, 'key-2');
    await create(service, undefined);
    await create(service, undefined);
    expect(repo.rows.size).toBe(4);
  });

  it('a concurrent request that wins the unique index is replayed, not an error', async () => {
    const { service, repo } = build();
    const winner = await create(service, 'key-1');
    jest
      .spyOn(repo, 'findByIdempotencyKey')
      .mockResolvedValueOnce(null) // the lookup that raced
      .mockResolvedValue(winner);
    jest
      .spyOn(repo, 'insert')
      .mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: '23505' }),
      );
    const out = await create(service, 'key-1');
    expect(out.props.id).toBe(winner.props.id);
  });

  it('the same key is independent per environment', async () => {
    const { service, repo } = build();
    await service.createFromEmission(
      recurringRequest(),
      TENANT,
      auth('test'),
      NOW,
      'k',
    );
    await service.createFromEmission(
      recurringRequest(),
      TENANT,
      auth('live'),
      NOW,
      'k',
    );
    expect(repo.rows.size).toBe(2);
  });
});
