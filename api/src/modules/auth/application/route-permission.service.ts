import { Injectable } from '@nestjs/common';
import { AuthContext } from '../auth-context';
import { TenantPermission } from '../domain/permission';
import { TenantPermissionDeniedError } from '../domain/errors';

@Injectable()
export class RoutePermissionService {
  hasPermission(
    auth: AuthContext,
    permission: TenantPermission,
    options: { allowPlatformAdmin?: boolean } = {},
  ): boolean {
    if (
      (auth.principalType ?? 'tenant_member') === 'tenant_member' &&
      auth.role === 'admin'
    ) {
      return true;
    }
    if (auth.isPlatformAdmin) {
      return Boolean(options.allowPlatformAdmin);
    }
    return auth.permissions.includes(permission);
  }

  assertPermission(
    auth: AuthContext,
    permission: TenantPermission,
    options: { allowPlatformAdmin?: boolean } = {},
  ): void {
    if (!this.hasPermission(auth, permission, options)) {
      throw new TenantPermissionDeniedError(permission);
    }
  }
}
