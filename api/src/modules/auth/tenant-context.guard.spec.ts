import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformAdminOnly } from './platform-admin-only.decorator';
import { TenantContextGuard } from './tenant-context.guard';

describe('TenantContextGuard', () => {
  const guard = new TenantContextGuard();
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';

  function createContext(request: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('rejects requests without an auth context', () => {
    expect(() => guard.canActivate(createContext({ params: {} }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an authenticated context without an active tenant UUID', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          params: {},
          authContext: { activeTenantId: '' },
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('allows matching tenant route params', () => {
    expect(
      guard.canActivate(
        createContext({
          params: { tenantId },
          authContext: {
            authUserId: 'auth-1',
            userId: 'user-1',
            tenantId,
            activeTenantId: tenantId,
            role: 'admin',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects cross-tenant access', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          params: { tenantId: otherTenantId },
          authContext: {
            authUserId: 'auth-1',
            userId: 'user-1',
            tenantId,
            activeTenantId: tenantId,
            role: 'admin',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('still rejects malformed tenant ids on tenant routes', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          originalUrl: '/v1/tenant/not-a-uuid/establishment',
          params: { tenantId: 'not-a-uuid' },
          authContext: {
            authUserId: 'auth-1',
            userId: 'user-1',
            tenantId,
            activeTenantId: tenantId,
            role: 'admin',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  describe('rota /v1/platform/tenants/:tenantId', () => {
    const request = () => ({
      originalUrl: `/v1/platform/tenants/${otherTenantId}/credit-grants`,
      params: { tenantId: otherTenantId },
      authContext: {
        authUserId: 'auth-1',
        userId: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        role: 'admin',
        permissions: [],
        isPlatformAdmin: false,
      },
    });
    const ctxWith = (adminOnly: boolean): ExecutionContext => {
      @(adminOnly ? PlatformAdminOnly() : () => undefined)
      class Controller {}
      return {
        switchToHttp: () => ({ getRequest: () => request() }),
        getHandler: () => () => undefined,
        getClass: () => Controller,
      } as unknown as ExecutionContext;
    };

    it('com PLATFORM_ADMIN_ONLY deixa passar (a barreira é o PlatformAdminGuard)', () => {
      expect(new TenantContextGuard().canActivate(ctxWith(true))).toBe(true);
    });

    it('sem PLATFORM_ADMIN_ONLY mantém a checagem de tenant', () => {
      expect(() =>
        new TenantContextGuard().canActivate(ctxWith(false)),
      ).toThrow(ForbiddenException);
    });
  });

  it('rejects malformed tenant route params', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          params: { tenantId: 'not-a-uuid' },
          authContext: {
            authUserId: 'auth-1',
            userId: 'user-1',
            tenantId,
            activeTenantId: tenantId,
            role: 'admin',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
