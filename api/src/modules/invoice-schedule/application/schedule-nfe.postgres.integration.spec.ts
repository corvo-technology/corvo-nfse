import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';
import { InvoiceSchedule } from '../domain/invoice-schedule';
import { TypeOrmInvoiceScheduleRepository } from '../infra/typeorm-invoice-schedule.repository';
import { ScheduleNfeAdapter } from './schedule-nfe.adapter';
import { ScheduleRunner } from './schedule-runner.service';

const NOW = new Date('2026-11-06T15:00:00Z'); // Friday
const RUN_DAY = '2026-11-09'; // Monday

/** NF-e schedules on a real schema: persistence, the daily run, and the NF-e intake behind it. */
describePostgres('NF-e schedules on PostgreSQL', () => {
  let h: PostgresHarness;
  let s: NfeStack;
  let repo: TypeOrmInvoiceScheduleRepository;
  let runner: ScheduleRunner;
  const notifier = {
    retryNotice: jest.fn().mockResolvedValue(undefined),
    paused: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    h = await createPostgresHarness('schednfe');
    s = createNfeStack(h);
    repo = new TypeOrmInvoiceScheduleRepository(h.runtime, h.transactions);
    const adapter = new ScheduleNfeAdapter(
      { validate: jest.fn().mockResolvedValue(undefined) } as never,
      s.intake,
      s.documents,
    );
    runner = new ScheduleRunner(
      repo,
      {} as never,
      {} as never,
      {} as never,
      h.unitOfWork,
      notifier,
      adapter,
      500,
    );
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const create = async (
    body: Record<string, unknown> = { ...s.input('FAKE-100') },
    kind: 'once' | 'recurring' = 'recurring',
  ) => {
    const schedule = InvoiceSchedule.create(
      {
        tenantId: h.tenantId,
        environment: 'test',
        companyId: h.companyId,
        documentType: 'nfe',
        kind,
        frequency: kind === 'recurring' ? 'WEEKLY' : null,
        firstOn: RUN_DAY,
        endsOn: null,
        invoiceInput: body,
        createdBy: null,
      },
      NOW,
      15,
    );
    await repo.insert(schedule);
    return schedule;
  };
  const documentsOf = async (scheduleId: string) => {
    const rows: Array<{ id: string; idempotency_key: string; model: number }> =
      await h.admin.query(
        `SELECT id, idempotency_key, model FROM "${h.schema}".nfe_documents WHERE idempotency_key LIKE $1 ORDER BY created_at`,
        [`schedule:${scheduleId}:%`],
      );
    return rows;
  };
  const dueNow = (scheduleId: string, day = RUN_DAY) =>
    h.admin.query(
      `UPDATE "${h.schema}".invoice_schedules SET next_run_on = $2 WHERE id = $1`,
      [scheduleId, day],
    );

  it('persists the document type and the validated NF-e body, and old rows default to NFS-e', async () => {
    const schedule = await create();
    const loaded = await repo.findById(schedule.props.id, h.tenantId);
    expect(loaded?.props.documentType).toBe('nfe');
    expect(loaded?.props.invoiceInput).toEqual(schedule.props.invoiceInput);
    const nfse = InvoiceSchedule.create(
      {
        tenantId: h.tenantId,
        environment: 'test',
        companyId: h.companyId,
        kind: 'once',
        frequency: null,
        firstOn: RUN_DAY,
        endsOn: null,
        invoiceInput: { amount: 1 },
        createdBy: null,
      },
      NOW,
      15,
    );
    await repo.insert(nfse);
    expect(
      (await repo.findById(nfse.props.id, h.tenantId))?.props.documentType,
    ).toBe('nfse');
    const listed = await repo.list(
      h.tenantId,
      { environment: 'test', documentTypes: ['nfe'] },
      { limit: 50, offset: 0 },
    );
    expect(listed.items.every((x) => x.props.documentType === 'nfe')).toBe(
      true,
    );
    expect(listed.items.some((x) => x.props.id === schedule.props.id)).toBe(
      true,
    );
    const none = await repo.list(
      h.tenantId,
      { documentTypes: [] },
      { limit: 50, offset: 0 },
    );
    expect(none.total).toBe(0);
    // Keep the daily run of the next tests to the NF-e schedules.
    await h.admin.query(
      `DELETE FROM "${h.schema}".invoice_schedules WHERE document_type = 'nfse'`,
    );
  });

  it('the run queues a real NF-e with the key of the schedule and the day, logs it and moves to the next week', async () => {
    const schedule = await create();
    const summary = await runner.runDue(RUN_DAY);
    expect(summary).toMatchObject({ errors: 0, paused: 0 });
    const docs = await documentsOf(schedule.props.id);
    expect(docs).toEqual([
      expect.objectContaining({
        idempotency_key: `schedule:${schedule.props.id}:${RUN_DAY}`,
        model: 55,
      }),
    ]);
    const { items } = await repo.listRuns(schedule.props.id, h.tenantId, {
      limit: 10,
      offset: 0,
    });
    expect(items[0]).toMatchObject({
      outcome: 'issued',
      invoiceId: docs[0]?.id,
      occurrenceOn: RUN_DAY,
    });
    const after = await repo.findById(schedule.props.id, h.tenantId);
    expect(after?.props).toMatchObject({
      nextRunOn: '2026-11-16',
      lastRunOn: RUN_DAY,
    });
    expect((await s.row(docs[0].id)).status).toBe('queued');
  });

  it('running the same occurrence again never issues a second note (retry or restart)', async () => {
    const schedule = await create();
    await runner.runDue(RUN_DAY);
    await dueNow(schedule.props.id);
    const again = await runner.runDue(RUN_DAY);
    expect(again.errors).toBe(0);
    expect(await documentsOf(schedule.props.id)).toHaveLength(1);
  });

  it('a single schedule completes after its run', async () => {
    const schedule = await create({ ...s.input('FAKE-100') }, 'once');
    await runner.runDue(RUN_DAY);
    expect(
      (await repo.findById(schedule.props.id, h.tenantId))?.props,
    ).toMatchObject({ status: 'completed', nextRunOn: null });
    expect(await documentsOf(schedule.props.id)).toHaveLength(1);
  });

  it('an NF-e the validators refuse is a failed attempt: nothing is issued, the third pauses the schedule', async () => {
    const good = s.input('FAKE-100');
    const bad = {
      ...good,
      items: [{ ...good.items[0], ncm: '1234567' }],
    };
    const schedule = await create({ ...bad }, 'recurring');
    await runner.runDue(RUN_DAY);
    const first = await repo.findById(schedule.props.id, h.tenantId);
    expect(first?.props.attempts).toBe(1);
    const { items } = await repo.listRuns(schedule.props.id, h.tenantId, {
      limit: 10,
      offset: 0,
    });
    expect(items[0]).toMatchObject({
      outcome: 'failed',
      errorCode: expect.stringContaining('NFE_VALIDATION_FAILED') as string,
    });
    expect(await documentsOf(schedule.props.id)).toHaveLength(0);
    await runner.runDue('2026-11-10');
    await runner.runDue('2026-11-11');
    expect(
      (await repo.findById(schedule.props.id, h.tenantId))?.props,
    ).toMatchObject({ status: 'paused', pauseReason: 'failures' });
    // The test environment never e-mails.
    expect(notifier.paused).not.toHaveBeenCalled();
  });
});
