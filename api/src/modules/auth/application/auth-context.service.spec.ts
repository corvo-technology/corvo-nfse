/* eslint-disable @typescript-eslint/await-thenable */
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import {
  TenantAccessDeniedError,
  TenantMembershipNotFoundError,
} from '../domain/errors';
import { makeMembership } from './auth-test-fixtures';
import { AuthContextService } from './auth-context.service';
import { AuthContextCacheService } from './auth-context-cache.service';

function createService() {
  const membershipRepo: jest.Mocked<ITenantMembershipRepository> = {
    findById: jest.fn(),
    findByAuthUserAndTenant: jest.fn(),
    listActiveByAuthUser: jest.fn(),
    listActiveByAuthUserAndProduct: jest.fn(),
    listActiveWithEstablishmentByAuthUserAndProduct: jest.fn(),
    findByAuthUserTenantAndProduct: jest.fn(),
    listActiveByTenant: jest.fn(),
    listPage: jest.fn(),
    listByTenant: jest.fn(),
    listWithAuthEmail: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const contextCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new AuthContextService(
      membershipRepo,
      contextCache as unknown as AuthContextCacheService,
    ),
    membershipRepo,
    contextCache,
  };
}

describe('AuthContextService', () => {
  it('returns a cached context without querying membership repository', async () => {
    const { service, contextCache, membershipRepo } = createService();
    contextCache.get.mockResolvedValue({
      authUserId: 'auth-user-1',
      productKey: 'greenbarber',
      userId: 'membership-1',
      tenantId: 'tenant-1',
      activeTenantId: 'tenant-1',
      role: 'admin',
      contextType: 'tenant',
      platformRole: null,
      platformPermissions: [],
      permissions: [],
      isPlatformAdmin: false,
      availableTenants: [],
      membershipStatus: 'active',
    });

    const result = await service.buildForAuthUser(
      'auth-user-1',
      'greenbarber',
      'tenant-1',
    );

    expect(result.activeTenantId).toBe('tenant-1');
    expect(
      membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct,
    ).not.toHaveBeenCalled();
  });

  it('builds context for active tenant membership', async () => {
    const { service, membershipRepo } = createService();
    membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct.mockResolvedValue(
      [
        {
          ...makeMembership({ tenantId: 'tenant-1' }),
          establishmentName: 'Studio Um',
        },
        {
          ...makeMembership({ id: 'membership-2', tenantId: 'tenant-2' }),
          establishmentName: 'Studio Dois',
        },
      ],
    );

    const result = await service.buildForAuthUser(
      'auth-user-1',
      'greenbarber',
      'tenant-2',
    );

    expect(result.activeTenantId).toBe('tenant-2');
    expect(result.membershipId).toBe('membership-2');
    expect(result.availableTenants).toHaveLength(2);
    expect(result.availableTenants).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-1',
        establishmentName: 'Studio Um',
      }),
      expect.objectContaining({
        tenantId: 'tenant-2',
        establishmentName: 'Studio Dois',
      }),
    ]);
    expect(result.isPlatformAdmin).toBe(false);
    expect(result.contextType).toBe('tenant');
    expect(result.platformRole).toBeNull();
    expect(result.platformPermissions).toEqual([]);
  });

  it('coalesces concurrent cache misses for the same tenant context', async () => {
    const { service, membershipRepo } = createService();
    let resolveMemberships!: (
      value: ReturnType<typeof makeMembership>[],
    ) => void;
    membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct.mockReturnValue(
      new Promise((resolve) => {
        resolveMemberships = resolve;
      }),
    );

    const first = service.buildForAuthUser('auth-user-1', 'greenbarber');
    const second = service.buildForAuthUser('auth-user-1', 'greenbarber');
    resolveMemberships([
      { ...makeMembership(), establishmentName: 'Studio Um' },
    ]);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(
      membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects an active tenant id outside the user memberships', async () => {
    const { service, membershipRepo } = createService();
    membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct.mockResolvedValue(
      [
        {
          ...makeMembership({ tenantId: 'tenant-1' }),
          establishmentName: 'Studio Um',
        },
        {
          ...makeMembership({ id: 'membership-2', tenantId: 'tenant-2' }),
          establishmentName: 'Studio Dois',
        },
      ],
    );

    await expect(
      service.buildForAuthUser('auth-user-1', 'greenbarber', 'tenant-3'),
    ).rejects.toThrow(TenantAccessDeniedError);
  });

  it('rejects users without membership', async () => {
    const { service, membershipRepo } = createService();
    membershipRepo.listActiveWithEstablishmentByAuthUserAndProduct.mockResolvedValue(
      [],
    );

    await expect(
      service.buildForAuthUser('auth-user-1', 'greenbarber'),
    ).rejects.toThrow(TenantMembershipNotFoundError);
  });

  it('builds scoped API-key contexts without a tenant-member principal', async () => {
    const { service } = createService();

    const result = await service.buildForApiKey(
      'tenant-1',
      'invoices_view',
      'test',
    );

    expect(result.principalType).toBe('api_key');
    expect(result.permissions).toEqual(['nfse.invoices.view']);
    expect(result.apiKeyEnvironment).toBe('test');
  });
});
