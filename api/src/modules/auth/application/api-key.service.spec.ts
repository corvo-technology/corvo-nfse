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
    save: jest.fn(),
    remove: jest.fn(),
  } as jest.Mocked<IApiKeyRepository>;
  const service = new ApiKeyService(repository);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('stores the complete generated lookup prefix', async () => {
    (argon2.hash as jest.Mock).mockResolvedValue('hash');
    repository.save.mockImplementation(async (key) => key);

    const result = await service.create(
      { activeTenantId: 'tenant-id' } as any,
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
});
