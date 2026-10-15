import type { TenantPermission, TenantMembershipRole } from './permission';

export interface NewWorkspace {
  tenantId: string;
  authUserId: string;
  planId: string;
  billingEmail: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  role: TenantMembershipRole;
  permissions: TenantPermission[];
}

export abstract class IWorkspaceRepository {
  /** Requires an active unit of work; serializes bootstrap for this account. */
  abstract lockUser(userId: string): Promise<void>;
  abstract memberships(userId: string): Promise<Array<{ isActive: boolean }>>;
  abstract freePlanId(): Promise<string>;
  abstract hasFreeWorkspaceWithEmail(
    email: string,
    freePlanId: string,
  ): Promise<boolean>;
  abstract create(workspace: NewWorkspace): Promise<void>;
}
