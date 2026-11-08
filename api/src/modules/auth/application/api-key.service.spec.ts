/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ApiKeyService } from './api-key.service';
import { IApiKeyRepository } from '../domain/api-key.repository';
import { ApiKey } from '../domain/api-key';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

describe(ApiKeyService.name, () => {
  const repository = {
    findByKeyPrefix: jest.fn(),
    findByTenantId: jest.fn(),
    findById: jest.fn(),
    findByIdAndTenantId: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    removeByCreator: jest.fn(),
    touchLastUsed: jest.fn(),
  } as jest.Mocked<IApiKeyRepository>;
  const eventBus = { publishBestEffort: jest.fn() };
  const service = new ApiKeyService(repository, eventBus as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('scope vs. creator permissions', () => {
    const developer = {
      activeTenantId: 'tenant-id',
      role: 'developer',
      permissions: ['api_keys.manage', 'nfse.invoices.issue'],
    } as any;

    it('rejects a full_access key from a developer (would add certificate management)', async () => {
      await expect(
        service.create(developer, {
          name: 'k',
          environment: 'test',
          scope: 'full_access',
        }),
      ).rejects.toThrow(/permission/);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('records the creating member on the key', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hash');
      repository.save.mockImplementation(async (key) => key);
      await service.create(
        { ...developer, authUserId: 'user-1' },
        { name: 'k', environment: 'test', scope: 'invoices_issue' },
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ createdByUserId: 'user-1' }),
        'tenant-id',
      );
    });

    it('revokes every key created by a removed member', async () => {
      await service.revokeCreatedBy('tenant-id', 'user-1');
      expect(repository.removeByCreator).toHaveBeenCalledWith(
        'tenant-id',
        'user-1',
      );
    });

    it('allows a developer to create a key within their own permissions', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hash');
      repository.save.mockImplementation(async (key) => key);
      await expect(
        service.create(developer, {
          name: 'k',
          environment: 'test',
          scope: 'invoices_issue',
        }),
      ).resolves.toBeDefined();
    });
  });

  it('stores the complete generated lookup prefix', async () => {
    (argon2.hash as jest.Mock).mockResolvedValue('hash');
    repository.save.mockImplementation(async (key) => key);

    const result = await service.create(
      { activeTenantId: 'tenant-id', role: 'admin', permissions: [] } as any,
      { name: 'Production', environment: 'live', scope: 'full_access' },
    );

    expect(result.apiKey.keyPrefix).toMatch(/^corvo_live_[a-f0-9]{12}$/);
    expect(result.plaintext.startsWith(result.apiKey.keyPrefix)).toBe(true);
    expect(result.apiKey.keyPrefix).toHaveLength(23);
  });

  it('uses the complete generated lookup prefix when validating a key', async () => {
    const plaintext = `corvo_live_abcdef012345${'f'.repeat(28)}`;
    const key: ApiKey = {
      id: 'key-id',
      tenantId: 'tenant-id',
      name: 'Production',
      environment: 'live',
      keyPrefix: 'corvo_live_abcdef012345',
      keyHash: 'hash',
      scope: 'full_access',
      createdAt: new Date(),
    };
    repository.findByKeyPrefix.mockResolvedValue(key);
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    await expect(service.validate(plaintext)).resolves.toBe(key);

    expect(repository.findByKeyPrefix).toHaveBeenCalledWith(key.keyPrefix);
  });

  it('rejects malformed API keys without querying the repository', async () => {
    await expect(service.validate('corvo_live_invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.findByKeyPrefix).not.toHaveBeenCalled();
  });

  describe('touchLastUsed', () => {
    it('issues a direct repository update and never finds or saves the key', async () => {
      repository.touchLastUsed.mockResolvedValue(undefined);

      await service.touchLastUsed('key-id', 'tenant-id');

      expect(repository.touchLastUsed).toHaveBeenCalledWith(
        'key-id',
        'tenant-id',
        expect.any(Date),
      );
      expect(repository.findByIdAndTenantId).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('keeps a deleted key deleted and authentication failing', async () => {
      const plaintext = `corvo_live_abcdef012345${'f'.repeat(28)}`;
      const key: ApiKey = {
        id: 'key-id',
        tenantId: 'tenant-id',
        name: 'Production',
        environment: 'live',
        keyPrefix: 'corvo_live_abcdef012345',
        keyHash: 'hash',
        scope: 'full_access',
        createdAt: new Date(),
      };
      // Stateful fake: the row was removed, but a stale copy may still be read.
      const store = new Map<string, ApiKey>();
      repository.findByIdAndTenantId.mockResolvedValue({ ...key });
      repository.save.mockImplementation(async (row) => {
        store.set(row.keyPrefix, row); // mirrors the update-or-insert helper
        return row;
      });
      repository.touchLastUsed.mockResolvedValue(undefined); // 0 rows affected
      repository.findByKeyPrefix.mockImplementation(
        async (prefix) => store.get(prefix) ?? null,
      );
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.touchLastUsed('key-id', 'tenant-id'),
      ).resolves.toBeUndefined();

      expect(store.size).toBe(0);
      expect(repository.save).not.toHaveBeenCalled();
      await expect(service.validate(plaintext)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
