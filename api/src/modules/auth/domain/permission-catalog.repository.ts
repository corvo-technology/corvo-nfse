import { PermissionCatalogItem, TenantPermission } from './permission';

export abstract class IPermissionCatalogRepository {
  abstract list(): Promise<PermissionCatalogItem[]>;
  abstract exists(permission: TenantPermission): Promise<boolean>;
}
