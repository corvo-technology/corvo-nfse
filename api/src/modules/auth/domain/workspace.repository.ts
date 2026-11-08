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
  /** Credit the one-time free note together with the workspace. */
  grantFirstFreeNote: boolean;
}

export abstract class IWorkspaceRepository {
  /** Requires an active unit of work; serializes bootstrap for this account. */
  abstract lockUser(userId: string): Promise<void>;
  abstract memberships(
    userId: string,
  ): Promise<Array<{ isActive: boolean; tenantId: string }>>;
  abstract freePlanId(): Promise<string>;
  /** Atomically claims the one-time free note for this person; false if already claimed. */
  abstract claimFirstFreeNote(
    emailKey: string,
    tenantId: string,
  ): Promise<boolean>;
  abstract create(workspace: NewWorkspace): Promise<void>;
}
