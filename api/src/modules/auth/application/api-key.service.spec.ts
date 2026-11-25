/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as sentry from '@/infra/observability/sentry-reporter';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
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
  const audit = new FakeAccountAudit();
  const service = new ApiKeyService(repository, eventBus as never, audit);

  beforeEach(() => {
    jest.resetAllMocks();
    audit.events.length = 0;
  });

  describe('audit', () => {
    const admin = {
      activeTenantId: 'tenant-id',
      role: 'admin',
      permissions: [],
    } as any;

    it('records api_key.created with the name and prefix, never the key or its hash', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('argon2-secret-hash');
      repository.save.mockImplementation(async (key) => key);

      const { apiKey, plaintext } = await service.create(admin, {
        name: 'Production',
        environment: 'live',
        scope: 'full_access',
      });

      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({
        tenantId: 'tenant-id',
        environment: 'live',
        action: 'api_key.created',
        target: { type: 'api_key', id: apiKey.id, label: 'Production' },
        metadata: { key_prefix: apiKey.keyPrefix, scope: 'full_access' },
      });
      const dump = JSON.stringify(audit.events);
      expect(dump).not.toContain(plaintext);
      expect(dump).not.toContain('argon2-secret-hash');
      expect(dump).not.toContain('keyHash');
    });

    it('records api_key.revoked on revoke and on delete', async () => {
      const key = {
        id: 'key-1',
        tenantId: 'tenant-id',
        name: 'CI',
        environment: 'test',
        keyPrefix: 'corvo_test_abcdef012345',
        keyHash: 'argon2-secret-hash',
        scope: 'invoices_issue',
        createdAt: new Date(),
      };
      repository.findByIdAndTenantId.mockResolvedValue(key as ApiKey);
      repository.remove.mockResolvedValue(undefined);

      await service.revoke(admin, 'key-1');
      await service.delete('tenant-id', 'key-1');

      expect(audit.events.map((e) => e.action)).toEqual([
        'api_key.revoked',
        'api_key.revoked',
      ]);
      expect(audit.events[0]).toMatchObject({
        environment: 'test',
        target: { type: 'api_key', id: 'key-1', label: 'CI' },
        metadata: { key_prefix: 'corvo_test_abcdef012345' },
      });
      expect(JSON.stringify(audit.events)).not.toContain('argon2-secret-hash');
    });

    it('records nothing when the key does not exist', async () => {
      repository.findByIdAndTenantId.mockResolvedValue(null);
      await expect(service.revoke(admin, 'nope')).rejects.toThrow();
      expect(audit.events).toHaveLength(0);
    });

    it('keeps the action when the recorder fails', async () => {
      jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
      (argon2.hash as jest.Mock).mockResolvedValue('hash');
      repository.save.mockImplementation(async (key) => key);
      const failing = new ApiKeyService(
        repository,
        eventBus as never,
        failingAccountAudit(),
      );
      await expect(
        failing.create(admin, {
          name: 'k',
          environment: 'test',
          scope: 'invoices_issue',
        }),
      ).resolves.toMatchObject({ plaintext: expect.any(String) });
    });
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
