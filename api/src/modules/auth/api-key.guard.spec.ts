import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

  it('chave de API em rota PlatformAdminOnly recebe 404, não 403', async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => key === 'platformAdminOnly'),
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

    const err = await guard
      .canActivate(context({ headers: { 'x-api-key': 'corvo_live_test' } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(authContext.buildForApiKey).not.toHaveBeenCalled();
  });

  it('chave de API em rota comum sem @ApiKeyEndpoint segue com 403 API_KEY_NOT_ALLOWED', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const service = {
      validate: jest.fn().mockResolvedValue({
        id: 'key-1',
        tenantId: 'tenant-1',
        environment: 'live',
        scope: 'full_access',
      }),
    };
    const guard = new ApiKeyGuard(
      reflector as never,
      service as never,
      { buildForApiKey: jest.fn() } as never,
    );

    const err = await guard
      .canActivate(context({ headers: { 'x-api-key': 'corvo_live_test' } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'API_KEY_NOT_ALLOWED',
    });
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
