import type { DataSource } from 'typeorm';
import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { DocsRecoveryScheduler } from './docs-recovery.scheduler';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import type { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';

describe('DocsRecoveryScheduler', () => {
  const findAuthorizedWithoutDocuments = jest.fn();
  const mockInvoiceRepo: IInvoiceRepository = {
    findByAccessKeyAndTenantId: jest.fn(),
    listPage: jest.fn(),
    findByIdAndTenantId: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    findByTenantId: jest.fn(),
    save: jest.fn(),
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

  type FiscalRow = Pick<
    InvoiceOrmEntity,
    'id' | 'tenantId' | 'companyId' | 'status' | 'scheduledFor'
  >;
  let fiscalRows: FiscalRow[] = [];
  let selectedStatuses: string[] = [];
  let selectedTenant = '';
  const where = jest.fn((_sql: string, parameters: { statuses: string[] }) => {
    selectedStatuses = parameters.statuses;
    return query;
  });
  const andWhere = jest.fn((_sql: string, parameters: { tenantId: string }) => {
    selectedTenant = parameters.tenantId;
    return query;
  });
  const query = {
    where,
    andWhere,
    take: jest.fn().mockReturnThis(),
    getMany: async () =>
      fiscalRows.filter(
        (row) =>
          selectedStatuses.includes(row.status) &&
          row.tenantId === selectedTenant,
      ),
  };
  const database = {
    getRepository: () => ({ createQueryBuilder: () => query }),
  } as unknown as DataSource;
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
    database,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fiscalRows = [];
    selectedStatuses = [];
    selectedTenant = '';
    findAuthorizedWithoutDocuments.mockResolvedValue([]);
  });

  it('does not query or re-enqueue queued invoices, including scheduled invoices', async () => {
    fiscalRows = [
      {
        id: 'queued',
        tenantId: 'tenant-a',
        companyId: 'comp-1',
        status: 'queued',
        scheduledFor: null,
      },
      {
        id: 'scheduled',
        tenantId: 'tenant-b',
        companyId: 'comp-2',
        status: 'queued',
        scheduledFor: new Date(Date.now() + 86400000),
      },
    ];
    await scheduler.handle();
    expect(where).toHaveBeenCalledWith('i.status IN (:...statuses)', {
      statuses: ['processing', 'reconciliation_required'],
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it('recovers processing and reconciliation_required invoices through reconciliation', async () => {
    fiscalRows = [
      {
        id: 'processing',
        tenantId: 'tenant-a',
        companyId: 'comp-1',
        status: 'processing',
        scheduledFor: null,
      },
      {
        id: 'reconciliation',
        tenantId: 'tenant-b',
        companyId: 'comp-2',
        status: 'reconciliation_required',
        scheduledFor: null,
      },
    ];
    await scheduler.handle();
    expect(addMock).toHaveBeenCalledTimes(2);
    for (const row of fiscalRows) {
      expect(addMock).toHaveBeenCalledWith(
        'nfse-reconciliation',
        'recover',
        {
          invoiceId: row.id,
          tenantId: row.tenantId,
          companyId: row.companyId,
        },
        {
          attempts: 5,
          backoffMs: 30000,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    }
    expect(andWhere).toHaveBeenCalledWith(
      'i.updated_at < :cutoff AND i.tenant_id = :tenantId',
      { cutoff: expect.any(Date), tenantId: 'tenant-a' },
    );
    expect(andWhere).toHaveBeenCalledWith(
      'i.updated_at < :cutoff AND i.tenant_id = :tenantId',
      { cutoff: expect.any(Date), tenantId: 'tenant-b' },
    );
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
});
