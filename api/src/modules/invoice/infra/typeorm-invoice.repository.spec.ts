import {
  applyOrigin,
  TypeOrmInvoiceRepository,
} from './typeorm-invoice.repository';
import { Invoice } from '../domain/invoice';
import type { InvoiceStatus } from '../domain/invoice-status';

describe('TypeOrmInvoiceRepository', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const repository = new TypeOrmInvoiceRepository({
    repository: () => mockRepo,
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('markDocumentsReady', () => {
    it('returns true when documents_ready_at was NULL and is now set', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await repository.markDocumentsReady(
        'inv-1',
        tenantId,
        new Date(),
      );

      expect(result).toBe(true);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        documentsReadyAt: expect.any(Date),
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'documents_ready_at IS NULL',
      );
    });

    it('returns false when documents_ready_at was already set (race condition)', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await repository.markDocumentsReady(
        'inv-1',
        tenantId,
        new Date(),
      );

      expect(result).toBe(false);
    });
  });

  describe('updateEmailStatus', () => {
    it('updates lastEmailStatus and lastEmailSentAt', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const sentAt = new Date();
      await repository.updateEmailStatus('inv-1', tenantId, 'sent', sentAt);

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        lastEmailStatus: 'sent',
        lastEmailSentAt: sentAt,
      });
    });

    it('updates only lastEmailStatus when sentAt is omitted', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      await repository.updateEmailStatus('inv-1', tenantId, 'queued');

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        lastEmailStatus: 'queued',
        lastEmailSentAt: undefined,
      });
    });
  });

  describe('findAuthorizedWithoutDocuments', () => {
    it('returns id, tenantId, companyId for authorized invoices without documents', async () => {
      const olderThan = new Date();
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'inv-1', tenantId: 'tenant-1', companyId: 'comp-1' },
          { id: 'inv-2', tenantId: 'tenant-1', companyId: 'comp-2' },
        ]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await repository.findAuthorizedWithoutDocuments(
        tenantId,
        olderThan,
        10,
      );

      expect(result).toEqual([
        { id: 'inv-1', tenantId: 'tenant-1', companyId: 'comp-1' },
        { id: 'inv-2', tenantId: 'tenant-1', companyId: 'comp-2' },
      ]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'invoice.status IN (:...statuses) AND invoice.tenant_id = :tenantId',
        { statuses: ['authorized', 'cancelling', 'cancelled'], tenantId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenNthCalledWith(
        1,
        "(invoice.documents_ready_at IS NULL OR (invoice.status = 'authorized' AND invoice.email_snapshot->>'send' = 'true' AND invoice.last_email_status IS NULL))",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenNthCalledWith(
        2,
        'invoice.authorized_at < :olderThan',
        { olderThan },
      );
    });

    it('returns empty array when no invoices match', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await repository.findAuthorizedWithoutDocuments(
        tenantId,
        new Date(),
        10,
      );

      expect(result).toEqual([]);
    });
  });

  describe('saveDpsInfo', () => {
    it('updates only the DPS columns so a concurrent status change survives', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb as any);
      const invoice = {
        toSnapshot: () => ({
          id: 'inv-1',
          tenantId,
          dpsId: 'dps-uuid',
          dpsSeries: '1',
          dpsNumber: 7,
        }),
      } as any;

      await repository.saveDpsInfo(invoice);

      expect(qb.set).toHaveBeenCalledWith({
        dpsId: 'dps-uuid',
        dpsSeries: '1',
        dpsNumber: 7,
      });
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND tenant_id = :tenantId',
        { id: 'inv-1', tenantId },
      );
    });

    it('issues no UPDATE when there is no DPS information to persist', async () => {
      const invoice = {
        toSnapshot: () => ({
          id: 'inv-1',
          tenantId,
          dpsId: null,
          dpsSeries: null,
          dpsNumber: null,
        }),
      } as any;

      await repository.saveDpsInfo(invoice);

      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    function qbCapturing(sets: Record<string, unknown>[]) {
      const qb: Record<string, jest.Mock> = {};
      qb.update = jest.fn(() => qb);
      qb.set = jest.fn((values: Record<string, unknown>) => {
        sets.push(values);
        return qb;
      });
      qb.where = jest.fn(() => qb);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
      return qb;
    }

    function invoiceIn(status: InvoiceStatus): Invoice {
      const created = Invoice.create(
        {
          companyId: '22222222-2222-4222-8222-222222222222',
          customer: { taxId: '52998224725', name: 'Cliente' },
          service: {
            description: 'Servico',
            code: '060101',
            municipalityCode: '3550308',
          },
          amount: 50,
          competenceDate: new Date('2026-10-13'),
        },
        tenantId,
      );
      return Invoice.reconstitute({ ...created.toSnapshot(), status });
    }

    it('clears the pending fiscal XML once the invoice is cancelled', async () => {
      const sets: Record<string, unknown>[] = [];
      mockRepo.createQueryBuilder.mockReturnValue(qbCapturing(sets));

      await repository.save(invoiceIn('cancelled'), tenantId);

      expect(sets[0]).toMatchObject({ pendingEmission: null });
    });

    it('keeps the pending fiscal event while cancelling', async () => {
      const sets: Record<string, unknown>[] = [];
      mockRepo.createQueryBuilder.mockReturnValue(qbCapturing(sets));

      await repository.save(invoiceIn('cancelling'), tenantId);

      // The mapped entity may carry the key as undefined, which TypeORM skips on update.
      expect(sets[0].pendingEmission).toBeUndefined();
    });

    const cancellationColumns = [
      'cancellationReason',
      'cancellationDescription',
      'cancellationRequestedAt',
    ];

    it('writes the cancellation request columns by default', async () => {
      const sets: Record<string, unknown>[] = [];
      mockRepo.createQueryBuilder.mockReturnValue(qbCapturing(sets));

      await repository.save(invoiceIn('processing'), tenantId);

      for (const column of cancellationColumns)
        expect(sets[0][column]).toBeNull();
    });

    it('leaves the cancellation request columns out of the update when asked to preserve them', async () => {
      const sets: Record<string, unknown>[] = [];
      mockRepo.createQueryBuilder.mockReturnValue(qbCapturing(sets));

      await repository.save(invoiceIn('retry_pending'), tenantId, {
        preserveCancellationRequest: true,
      });

      // TypeORM skips undefined values, so the stored intent survives.
      for (const column of cancellationColumns)
        expect(sets[0][column]).toBeUndefined();
      expect(sets[0]).toMatchObject({ status: 'retry_pending' });
    });
  });

  describe('findByIdAndTenantId', () => {
    function readingQb() {
      return {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
    }

    it('locks the row (FOR UPDATE) when asked, so a concurrent intent write waits for the commit', async () => {
      const qb = readingQb();
      mockRepo.createQueryBuilder.mockReturnValue(qb as any);

      await repository.findByIdAndTenantId('inv-1', tenantId, 'live', {
        forUpdate: true,
      });

      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(qb.getOne).toHaveBeenCalledTimes(1);
    });

    it('is a plain read by default', async () => {
      const qb = readingQb();
      mockRepo.createQueryBuilder.mockReturnValue(qb as any);

      await repository.findByIdAndTenantId('inv-1', tenantId, 'live');

      expect(qb.setLock).not.toHaveBeenCalled();
    });
  });

  describe('registerCancellationIntent', () => {
    function qbWith(affected: number) {
      return {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
    }
    const requestedAt = new Date('2026-10-14T12:00:00Z');
    const intent = {
      code: 'issue_error' as const,
      description: 'Valor informado incorretamente',
      requestedAt,
    };

    it('writes the intent only on a processing invoice without one and reports it', async () => {
      const qb = qbWith(1);
      mockRepo.createQueryBuilder.mockReturnValue(qb as any);

      await expect(
        repository.registerCancellationIntent('inv-1', tenantId, intent),
      ).resolves.toBe(true);

      expect(qb.set).toHaveBeenCalledWith({
        cancellationReason: 'issue_error',
        cancellationDescription: 'Valor informado incorretamente',
        cancellationRequestedAt: requestedAt,
      });
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND tenant_id = :tenantId',
        { id: 'inv-1', tenantId },
      );
      expect(qb.andWhere).toHaveBeenCalledWith("status = 'processing'");
      expect(qb.andWhere).toHaveBeenCalledWith(
        'cancellation_requested_at IS NULL',
      );
      expect(qb.execute).toHaveBeenCalledTimes(1);
    });

    it('reports false when no row matched (status changed or intent already pending)', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(qbWith(0) as any);

      await expect(
        repository.registerCancellationIntent('inv-1', tenantId, intent),
      ).resolves.toBe(false);
    });

    it('refuses an invalid tenant context before touching the database', async () => {
      await expect(
        repository.registerCancellationIntent('inv-1', 'not-a-tenant', intent),
      ).rejects.toThrow('A valid tenant context is required');
      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});

describe('applyOrigin', () => {
  const clauses = (origin: Parameters<typeof applyOrigin>[1]) => {
    const andWhere = jest.fn();
    applyOrigin({ andWhere } as never, origin);
    return (andWhere.mock.calls as string[][]).map((call) => call[0]);
  };

  it.each([
    ['integration', "LIKE 'integ\\_%'"],
    ['schedule', "LIKE 'schedule:%'"],
    ['import', "LIKE 'import:%'"],
  ] as const)('%s filters by the idempotency key prefix', (origin, like) => {
    const [only, ...rest] = clauses(origin);
    expect(rest).toEqual([]);
    expect(only).toContain('idempotency_key');
    expect(only).toContain(like);
  });

  it('dashboard excludes Corvo-made keys and keeps the dashboard reference', () => {
    const [keys, ref] = clauses('dashboard');
    expect(keys).toMatch(/^NOT \(.*integ.*schedule:.*import:/);
    expect(ref).toBe("COALESCE(invoice.external_id, '') LIKE 'dashboard-%'");
  });

  it('api is everything that is neither Corvo-made nor from the dashboard', () => {
    const [keys, ref] = clauses('api');
    expect(keys).toMatch(/^NOT \(/);
    expect(ref).toBe(
      "NOT (COALESCE(invoice.external_id, '') LIKE 'dashboard-%')",
    );
  });
});
