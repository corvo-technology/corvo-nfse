import { TypeormApiKeyRepository } from './typeorm-api-key.repository';

describe(TypeormApiKeyRepository.name, () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const repository = new TypeormApiKeyRepository(mockRepo as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('touchLastUsed', () => {
    it('runs a direct UPDATE scoped to id and tenant_id', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      const at = new Date();

      await repository.touchLastUsed('key-1', tenantId, at);

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({ lastUsedAt: at });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'id = :id AND tenant_id = :tenantId',
        { id: 'key-1', tenantId },
      );
      expect(mockRepo.insert).not.toHaveBeenCalled();
    });

    it('does not insert when no row matches (0 rows affected)', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(
        repository.touchLastUsed('deleted-key', tenantId, new Date()),
      ).resolves.toBeUndefined();

      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('does not read the row before updating it', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await repository.touchLastUsed('key-1', tenantId, new Date());

      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
