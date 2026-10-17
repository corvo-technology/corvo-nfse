import { TypeOrmInvoiceRepository } from './typeorm-invoice.repository';
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
  });
});
