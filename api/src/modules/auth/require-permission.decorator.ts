import { SetMetadata } from '@nestjs/common';
import { TenantPermission } from './domain/permission';

export const REQUIRED_TENANT_PERMISSION = 'requiredTenantPermission';
export const ALLOW_PLATFORM_ADMIN_PERMISSION =
  'allowPlatformAdminPermissionBypass';
export type RequiredTenantPermission = TenantPermission | TenantPermission[];

export function RequirePermission(permission: RequiredTenantPermission) {
  return SetMetadata(REQUIRED_TENANT_PERMISSION, permission);
}

export function AllowPlatformAdminPermissionBypass() {
  return SetMetadata(ALLOW_PLATFORM_ADMIN_PERMISSION, true);
}
