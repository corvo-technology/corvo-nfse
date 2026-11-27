import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { DocsRecoveryScheduler } from './docs-recovery.scheduler';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import type { IFiscalReconciliationRepository } from '../domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import type { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { reconciliationJobKey } from '../application/reconciliation-job';
import * as scheduledTaskTelemetry from '@/shared/observability/scheduled-task-telemetry';

describe('DocsRecoveryScheduler', () => {
  const findAuthorizedWithoutDocuments = jest.fn();
  const mockInvoiceRepo: IInvoiceRepository = {
    findByAccessKeyAndTenantId: jest.fn(),
    listPage: jest.fn(),
    findByIdAndTenantId: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    findByTenantId: jest.fn(),
    save: jest.fn(),
    saveDpsInfo: jest.fn(),
    registerCancellationIntent: jest.fn(),
    insert: jest.fn(),
    findPendingReconciliation: jest.fn(),
    existsIdempotencyKey: jest.fn(),
    markDocumentsReady: jest.fn(),
    updateEmailStatus: jest.fn(),
    findAuthorizedWithoutDocuments,
  };

  const addMock = jest.fn().mockResolvedValue({
    id: 'job-id',
    queueName: 'nfse-doc-prep',
    jobName: 'prepare',
  });
  const mockQueueService = {
    add: addMock,
    addBulk: jest.fn(),
    schedule: jest.fn(),
    removeRepeatable: jest.fn(),
    getJobStatus: jest.fn(),
    config: {},
    getQueue: jest.fn(),
  } as unknown as BullmqQueueService;

  const findPendingReconciliation =
    mockInvoiceRepo.findPendingReconciliation as jest.Mock;
  const findAuthorizedWithoutReconciliation = jest.fn();
  const mockReconciliationRepo = {
    insert: jest.fn(),
    findByInvoiceId: jest.fn(),
    findAuthorizedWithoutReconciliation,
  } as unknown as IFiscalReconciliationRepository;
  const discovery = {
    visit: async (_kind: string, work: (id: string) => Promise<void>) => {
      await work('tenant-a');
      await work('tenant-b');
    },
  } as unknown as TenantWorkDiscovery;
  const scheduler = new DocsRecoveryScheduler(
    discovery,
    mockInvoiceRepo,
    mockQueueService,
    mockReconciliationRepo,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findPendingReconciliation.mockResolvedValue([]);
    findAuthorizedWithoutDocuments.mockResolvedValue([]);
    findAuthorizedWithoutReconciliation.mockResolvedValue([]);
  });

  it('observes recovery as a scheduled task', async () => {
    const observe = jest.spyOn(scheduledTaskTelemetry, 'observeScheduledTask');
    try {
      await scheduler.handle();
      expect(observe).toHaveBeenCalledWith(
        'invoice.docs-recovery',
        expect.any(Function),
      );
    } finally {
      observe.mockRestore();
    }
  });

  it('asks the repository for eligible reconciliation work under each tenant', async () => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    await scheduler.handle();
    expect(findPendingReconciliation).toHaveBeenCalledTimes(2);
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      expect(findPendingReconciliation).toHaveBeenCalledWith(
        tenantId,
        expect.any(Date),
        50,
      );
    }
    expect(
      (
        findPendingReconciliation.mock.calls as [string, Date, number][]
      )[0][1].getTime(),
    ).toBeGreaterThanOrEqual(cutoff);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('dispatches reconciliation references returned by the repository', async () => {
    const row = { id: 'processing', tenantId: 'tenant-a', companyId: 'comp-1' };
    findPendingReconciliation.mockImplementation(async (tenantId: string) =>
      tenantId === row.tenantId ? [row] : [],
    );
    await scheduler.handle();
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'recover',
      {
        invoiceId: row.id,
        tenantId: row.tenantId,
        companyId: row.companyId,
        attemptCount: 0,
      },
      {
        idempotencyKey: reconciliationJobKey(row.id, 0),
        attempts: 5,
        backoffMs: 30000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  describe('reconciliation storm', () => {
    const row = { id: 'inv-1767', tenantId: 'tenant-a', companyId: 'comp-1' };
    const getJobStatus = mockQueueService.getJobStatus as jest.Mock;

    it('does not queue a second chain while the invoice has a pending job', async () => {
      findPendingReconciliation.mockImplementation(async (tenantId: string) =>
        tenantId === row.tenantId ? [row] : [],
      );
      for (const state of ['delayed', 'active', 'waiting']) {
        getJobStatus.mockImplementation(async (_queue: string, id: string) =>
          id === reconciliationJobKey(row.id, 1).replace(/:/g, '_')
            ? state
            : null,
        );
        await scheduler.handle();
      }
      expect(addMock).not.toHaveBeenCalled();
    });

    it('over a day of runs a stuck invoice never has more than one chain', async () => {
      // A tiny queue with BullMQ's rule: adding an id that already exists is ignored.
      const pending = new Set<string>();
      addMock.mockImplementation(
        async (
          _q: string,
          _n: string,
          _d: unknown,
          o: { idempotencyKey: string },
        ) => {
          pending.add(o.idempotencyKey.replace(/:/g, '_'));
          return { id: o.idempotencyKey };
        },
      );
      getJobStatus.mockImplementation(async (_q: string, id: string) =>
        pending.has(id) ? 'delayed' : null,
      );
      findPendingReconciliation.mockImplementation(async (tenantId: string) =>
        tenantId === row.tenantId ? [row] : [],
      );

      for (let run = 0; run < 288; run++) await scheduler.handle();

      expect(addMock).toHaveBeenCalledTimes(1);
    });
  });

  it('enqueues a doc-prep job for each invoice returned by the query', async () => {
    const pending = [
      { id: 'inv-1', tenantId: 'tenant-a', companyId: 'comp-1' },
      { id: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
    ];
    findAuthorizedWithoutDocuments.mockImplementation(
      async (tenantId: string) =>
        pending.filter((row) => row.tenantId === tenantId),
    );
    addMock.mockResolvedValue({
      id: 'job-id',
      queueName: 'nfse-doc-prep',
      jobName: 'prepare',
    });

    await scheduler.handle();

    expect(findAuthorizedWithoutDocuments).toHaveBeenCalledTimes(2);
    const call = findAuthorizedWithoutDocuments.mock.calls[0] as [
      string,
      Date,
      number,
    ];
    expect(call[0]).toBe('tenant-a');
    expect(
      (
        findAuthorizedWithoutDocuments.mock.calls[1] as [string, Date, number]
      )[0],
    ).toBe('tenant-b');
    expect(call[1].getTime()).toBeGreaterThan(
      Date.now() - 5 * 60 * 1000 - 1000,
    );
    expect(call[2]).toBe(50);

    expect(addMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenNthCalledWith(
      1,
      'nfse-doc-prep',
      'prepare',
      { invoiceId: 'inv-1', tenantId: 'tenant-a', companyId: 'comp-1' },
      {
        attempts: 5,
        backoffMs: 10_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
    expect(addMock).toHaveBeenNthCalledWith(
      2,
      'nfse-doc-prep',
      'prepare',
      { invoiceId: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
      {
        attempts: 5,
        backoffMs: 10_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
  });

  it('does not enqueue when the query returns an empty array', async () => {
    findAuthorizedWithoutDocuments.mockResolvedValue([]);

    await scheduler.handle();

    expect(addMock).not.toHaveBeenCalled();
  });

  it('continues processing other invoices when one add fails', async () => {
    const pending = [
      { id: 'inv-1', tenantId: 'tenant-a', companyId: 'comp-1' },
      { id: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
    ];
    findAuthorizedWithoutDocuments.mockImplementation(
      async (tenantId: string) =>
        pending.filter((row) => row.tenantId === tenantId),
    );
    addMock
      .mockRejectedValueOnce(new Error('redis error'))
      .mockResolvedValueOnce({
        id: 'job-id-2',
        queueName: 'nfse-doc-prep',
        jobName: 'prepare',
      });

    await scheduler.handle();

    expect(addMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenNthCalledWith(
      2,
      'nfse-doc-prep',
      'prepare',
      { invoiceId: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
      expect.any(Object),
    );
  });

  it('re-enqueues nfse-fiscal-reconcile for authorized invoices pending reconciliation', async () => {
    const pending = [
      { id: 'inv-1', tenantId: 'tenant-a', companyId: 'comp-1' },
      { id: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
    ];
    findAuthorizedWithoutReconciliation.mockImplementation(
      async (tenantId: string) =>
        pending.filter((row) => row.tenantId === tenantId),
    );

    await scheduler.handle();

    expect(findAuthorizedWithoutReconciliation).toHaveBeenCalledTimes(2);
    const firstQuery = findAuthorizedWithoutReconciliation.mock.calls[0] as [
      string,
      Date,
      number,
    ];
    expect(firstQuery[0]).toBe('tenant-a');
    expect(firstQuery[1].getTime()).toBeGreaterThanOrEqual(
      Date.now() - 5 * 60 * 1000 - 1000,
    );
    expect(firstQuery[1].getTime()).toBeLessThanOrEqual(Date.now());
    expect(firstQuery[2]).toBe(50);
    expect(addMock).toHaveBeenCalledTimes(2);
    expect(addMock).toHaveBeenNthCalledWith(
      1,
      'nfse-fiscal-reconcile',
      'reconcile',
      { invoiceId: 'inv-1', tenantId: 'tenant-a', companyId: 'comp-1' },
      {
        idempotencyKey: 'fiscal-reconcile:inv-1',
        attempts: 5,
        backoffMs: 10_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
    expect(addMock).toHaveBeenNthCalledWith(
      2,
      'nfse-fiscal-reconcile',
      'reconcile',
      { invoiceId: 'inv-2', tenantId: 'tenant-b', companyId: 'comp-2' },
      {
        idempotencyKey: 'fiscal-reconcile:inv-2',
        attempts: 5,
        backoffMs: 10_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
  });

  it('keeps queued invoices out of the fiscal reconciliation pass', async () => {
    // queued invoices are owned by the outbox; the reconciliation query only
    // returns authorized invoices that already have a fiscal snapshot.
    findPendingReconciliation.mockResolvedValue([
      { id: 'inv-q', tenantId: 'tenant-a', companyId: 'comp-1' },
    ]);
    findAuthorizedWithoutReconciliation.mockResolvedValue([]);

    await scheduler.handle();

    expect(findAuthorizedWithoutReconciliation).toHaveBeenCalledTimes(2);
    const reconcileCalls = addMock.mock.calls.filter(
      (call: unknown[]) => call[0] === 'nfse-fiscal-reconcile',
    );
    expect(reconcileCalls).toHaveLength(0);
  });
});
