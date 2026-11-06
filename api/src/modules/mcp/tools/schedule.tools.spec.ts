import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { InvoiceSchedule } from '@/modules/invoice-schedule/domain/invoice-schedule';
import { ScheduleNotFoundError } from '@/modules/invoice-schedule/domain/schedule-errors';
import {
  createScheduleCancelHandler,
  createScheduleGetHandler,
  createScheduleListHandler,
  createSchedulePauseHandler,
  createScheduleResumeHandler,
  createScheduleRunsHandler,
  createScheduleUpdateHandler,
} from './schedule.tools';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-06T15:00:00Z');
const ctx = (environment: 'test' | 'live' = 'test') =>
  ({ tenantId: TENANT, executionEnvironment: environment }) as AuthContext;

const schedule = (environment: 'test' | 'live' = 'test') =>
  InvoiceSchedule.create(
    {
      tenantId: TENANT,
      environment,
      companyId: 'c1',
      kind: 'recurring',
      frequency: 'WEEKLY',
      firstOn: '2026-11-09',
      endsOn: null,
      invoiceInput: {
        companyId: 'c1',
        amount: 100,
        customer: { name: 'Ana', taxId: '52998224725' },
        service: { code: '010101', description: 'Consultoria' },
      },
      createdBy: null,
    },
    NOW,
    15,
  );

function build(found = schedule()) {
  const service = {
    get: jest.fn().mockResolvedValue(found),
    list: jest.fn().mockResolvedValue({ items: [found], total: 1 }),
    runs: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'r1',
          occurrenceOn: '2026-11-07',
          ranOn: '2026-11-09',
          attempt: 1,
          outcome: 'failed',
          invoiceId: null,
          errorCode: 'ERROR_QUOTA_EXCEEDED',
          errorMessage: 'no credits',
          createdAt: NOW,
        },
      ],
      total: 1,
    }),
    update: jest.fn().mockResolvedValue(found),
    pause: jest.fn().mockResolvedValue(found),
    resume: jest.fn().mockResolvedValue(found),
    cancel: jest.fn().mockResolvedValue(found),
  };
  return service;
}

describe('schedule MCP tools', () => {
  it('schedule_list is limited to the connected environment and answers in snake_case', async () => {
    const service = build();
    const out = await createScheduleListHandler(service)(
      { status: 'active', limit: 10 },
      ctx(),
    );
    expect(service.list).toHaveBeenCalledWith(
      TENANT,
      { status: 'active', companyId: undefined, environment: 'test' },
      { limit: 10, offset: 0 },
    );
    expect(out).toMatchObject({
      total: 1,
      schedules: [
        { kind: 'recurring', next_run_on: '2026-11-09', company_id: 'c1' },
      ],
    });
  });

  it('schedule_get returns the schedule; one of the other environment is not found', async () => {
    const service = build();
    const out = await createScheduleGetHandler(service)(
      { schedule_id: ID },
      ctx(),
    );
    expect(out).toMatchObject({ status: 'active', frequency: 'WEEKLY' });
    const other = build(schedule('live'));
    await expect(
      createScheduleGetHandler(other)({ schedule_id: ID }, ctx('test')),
    ).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('every tool validates the id', async () => {
    const service = build();
    await expect(
      createSchedulePauseHandler(service)({ schedule_id: 'nope' }, ctx()),
    ).rejects.toThrow(/Invalid input/);
    expect(service.pause).not.toHaveBeenCalled();
  });

  it('schedule_runs lists attempts with the reason of a failure', async () => {
    const service = build();
    const out = await createScheduleRunsHandler(service)(
      { schedule_id: ID },
      ctx(),
    );
    expect(out.runs[0]).toMatchObject({
      occurrence_on: '2026-11-07',
      ran_on: '2026-11-09',
      outcome: 'failed',
      error_code: 'ERROR_QUOTA_EXCEEDED',
    });
  });

  it.each([
    ['pause', createSchedulePauseHandler],
    ['resume', createScheduleResumeHandler],
    ['cancel', createScheduleCancelHandler],
  ] as const)(
    'schedule_%s acts on the workspace schedule',
    async (action, factory) => {
      const service = build();
      await factory(service)({ schedule_id: ID }, ctx());
      expect(service[action]).toHaveBeenCalledWith(ID, TENANT);
    },
  );

  it('schedule_update merges partial objects over the stored body and passes the dates', async () => {
    const service = build();
    await createScheduleUpdateHandler(service)(
      {
        schedule_id: ID,
        amount: 250,
        description: 'Nova descrição',
        customer: { email: 'ana@example.com' },
        ends_on: null,
        frequency: 'MONTHLY',
        first_date: '2026-12-01',
      },
      ctx(),
    );
    expect(service.update).toHaveBeenCalledWith(ID, TENANT, {
      invoice: {
        amount: 250,
        customer: {
          name: 'Ana',
          taxId: '52998224725',
          email: 'ana@example.com',
        },
        service: { code: '010101', description: 'Nova descrição' },
      },
      endsOn: null,
      frequency: 'MONTHLY',
      anchorOn: '2026-12-01',
    });
  });

  it('schedule_update with only dates does not touch the invoice body', async () => {
    const service = build();
    await createScheduleUpdateHandler(service)(
      { schedule_id: ID, ends_on: '2027-01-31' },
      ctx(),
    );
    expect(service.update).toHaveBeenCalledWith(ID, TENANT, {
      invoice: undefined,
      endsOn: '2027-01-31',
      frequency: undefined,
      anchorOn: undefined,
    });
  });
});
