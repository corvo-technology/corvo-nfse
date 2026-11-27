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

/** The permission the 403 names, when the route accepts more than one (see `RequireDocumentPermission`). */
export const PERMISSION_DENIED_AS = 'permissionDeniedAs';

/**
 * For the `/v1/invoices` routes that serve more than one kind of document: the guard lets in a key
 * with the permission of either type, and the router checks the one of the document it reaches.
 * A caller with neither is told about the NFS-e permission, as before NF-e existed.
 */
export function RequireDocumentPermission(permissions: {
  nfse: TenantPermission;
  nfe: TenantPermission;
}) {
  return applyDecorators(
    RequirePermission([permissions.nfse, permissions.nfe]),
    SetMetadata(PERMISSION_DENIED_AS, permissions.nfse),
  );
}

export function AllowPlatformAdminPermissionBypass() {
  return SetMetadata(ALLOW_PLATFORM_ADMIN_PERMISSION, true);
}
