import type { TenantMembershipRole, TenantPermission } from './permission';

export type { TenantMembershipRole } from './permission';

export interface TenantMembership {
  id: string;
  authUserId: string;
  tenantId: string;
  role: TenantMembershipRole;
  permissions: TenantPermission[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
