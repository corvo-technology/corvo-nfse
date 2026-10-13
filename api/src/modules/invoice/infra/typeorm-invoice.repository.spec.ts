import { TypeOrmInvoiceRepository } from './typeorm-invoice.repository';

describe('TypeOrmInvoiceRepository', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const repository = new TypeOrmInvoiceRepository(mockRepo as any);

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
        'invoice.status = :status AND invoice.tenant_id = :tenantId',
        { status: 'authorized', tenantId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenNthCalledWith(
        1,
        "(invoice.documents_ready_at IS NULL OR (invoice.email_snapshot->>'send' = 'true' AND invoice.last_email_status IS NULL))",
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
});
