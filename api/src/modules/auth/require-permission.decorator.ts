import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { TenantPermission } from './domain/permission';

export const REQUIRED_TENANT_PERMISSION = 'requiredTenantPermission';
export const ALLOW_PLATFORM_ADMIN_PERMISSION =
  'allowPlatformAdminPermissionBypass';
export type RequiredTenantPermission = TenantPermission | TenantPermission[];

/** Extension that lets the public OpenAPI document say which permission a key needs. */
export const REQUIRED_PERMISSIONS_EXTENSION = 'x-required-permissions';

export function RequirePermission(permission: RequiredTenantPermission) {
  return applyDecorators(
    SetMetadata(REQUIRED_TENANT_PERMISSION, permission),
    ApiExtension(
      REQUIRED_PERMISSIONS_EXTENSION,
      Array.isArray(permission) ? permission : [permission],
    ),
  );
}

export function AllowPlatformAdminPermissionBypass() {
  return SetMetadata(ALLOW_PLATFORM_ADMIN_PERMISSION, true);
}
