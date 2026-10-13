import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoutePermissionService } from './application/route-permission.service';
import { PermissionGuard } from './permission.guard';
import { REQUIRED_TENANT_PERMISSION } from './require-permission.decorator';

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('rejects missing auth context', () => {
    const guard = new PermissionGuard(
      new Reflector(),
      new RoutePermissionService(),
    );

    expect(() => guard.canActivate(createContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows route without required permission metadata', () => {
    const guard = new PermissionGuard(
      new Reflector(),
      new RoutePermissionService(),
    );

    expect(
      guard.canActivate(
        createContext({
          authContext: {
            authUserId: 'auth-user-1',
            userId: 'membership-1',
            tenantId: 'tenant-1',
            activeTenantId: 'tenant-1',
            role: 'professional',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects route when permission is missing', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRED_TENANT_PERMISSION ? 'financial.manage' : false,
      ),
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector, new RoutePermissionService());

    expect(() =>
      guard.canActivate(
        createContext({
          authContext: {
            authUserId: 'auth-user-1',
            userId: 'membership-1',
            tenantId: 'tenant-1',
            activeTenantId: 'tenant-1',
            role: 'professional',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows route when any required permission is present', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRED_TENANT_PERMISSION
          ? ['financial.commissions.manage', 'financial.commissions.view.own']
          : false,
      ),
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector, new RoutePermissionService());

    expect(
      guard.canActivate(
        createContext({
          authContext: {
            authUserId: 'auth-user-1',
            userId: 'membership-1',
            tenantId: 'tenant-1',
            activeTenantId: 'tenant-1',
            role: 'professional',
            permissions: ['financial.commissions.view.own'],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not grant an API key the tenant-admin bypass', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRED_TENANT_PERMISSION ? 'webhooks.manage' : false,
      ),
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector, new RoutePermissionService());

    expect(() =>
      guard.canActivate(
        createContext({
          authContext: {
            authUserId: 'api-key',
            userId: 'api-key',
            tenantId: 'tenant-1',
            activeTenantId: 'tenant-1',
            role: 'admin',
            principalType: 'api_key',
            permissions: ['messages.view'],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('grants every tenant permission to a human admin', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRED_TENANT_PERMISSION ? 'billing.manage' : false,
      ),
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector, new RoutePermissionService());

    expect(
      guard.canActivate(
        createContext({
          authContext: {
            authUserId: 'auth-user-1',
            userId: 'membership-1',
            tenantId: 'tenant-1',
            activeTenantId: 'tenant-1',
            role: 'admin',
            principalType: 'tenant_member',
            permissions: [],
            isPlatformAdmin: false,
          },
        }),
      ),
    ).toBe(true);
  });
});
