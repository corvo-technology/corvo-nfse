import { ForbiddenException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  const context = (request: Record<string, unknown>) =>
    ({
      getHandler: () => class Handler {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  it('rejects an API key on an endpoint not marked for API-key access', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    const service = {
      validate: jest.fn().mockResolvedValue({
        id: 'key-1',
        tenantId: 'tenant-1',
        environment: 'live',
        scope: 'full_access',
      }),
    };
    const authContext = { buildForApiKey: jest.fn() };
    const guard = new ApiKeyGuard(
      reflector as never,
      service as never,
      authContext as never,
    );

    await expect(
      guard.canActivate(
        context({ headers: { 'x-api-key': 'corvo_live_test' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authContext.buildForApiKey).not.toHaveBeenCalled();
  });

  it('allows an API key on a marked endpoint and builds tenant context', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    };
    const service = {
      validate: jest.fn().mockResolvedValue({
        id: 'key-1',
        tenantId: 'tenant-1',
        environment: 'live',
        scope: 'send_only',
      }),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    const built = { activeTenantId: 'tenant-1' };
    const authContext = { buildForApiKey: jest.fn().mockReturnValue(built) };
    const guard = new ApiKeyGuard(
      reflector as never,
      service as never,
      authContext as never,
    );
    const request = { headers: { 'x-api-key': 'corvo_live_test' } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toMatchObject({ authContext: built, authMode: 'api_key' });
  });
});
