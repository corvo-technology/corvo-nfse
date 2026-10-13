import { AuthContextCacheService } from './auth-context-cache.service';
import { AuthContextInvalidationListener } from './auth-context-invalidation.listener';
import {
  authorizationContextChanged,
  authorizationTenantMetadataChanged,
} from './authorization.events';

describe(AuthContextInvalidationListener.name, () => {
  it('invalidates all variants belonging to the changed user', async () => {
    const cache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    const listener = new AuthContextInvalidationListener(
      cache as unknown as AuthContextCacheService,
      {} as never,
    );

    await listener.onContextChanged(authorizationContextChanged('auth-1'));

    expect(cache.invalidateUser).toHaveBeenCalledWith('auth-1');
  });

  it('invalidates every member when tenant metadata changes', async () => {
    const cache = {
      invalidateTenantUsers: jest.fn().mockResolvedValue(undefined),
    };
    const memberships = {
      listByTenant: jest
        .fn()
        .mockResolvedValue([
          { authUserId: 'auth-1' },
          { authUserId: 'auth-2' },
        ]),
    };
    const listener = new AuthContextInvalidationListener(
      cache as unknown as AuthContextCacheService,
      memberships as never,
    );

    await listener.onTenantMetadataChanged(
      authorizationTenantMetadataChanged('tenant-1'),
    );

    expect(cache.invalidateTenantUsers).toHaveBeenCalledWith([
      'auth-1',
      'auth-2',
    ]);
  });
});
