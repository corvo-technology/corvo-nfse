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
  /** Credit the one-time welcome notes together with the workspace. */
  grantWelcomeNotes: boolean;
}

export abstract class IWorkspaceRepository {
  /** Requires an active unit of work; serializes bootstrap for this account. */
  abstract lockUser(userId: string): Promise<void>;
  abstract memberships(
    userId: string,
  ): Promise<Array<{ isActive: boolean; tenantId: string }>>;
  abstract freePlanId(): Promise<string>;
  /** The single plan of a self-hosted instance. */
  abstract selfHostedPlanId(): Promise<string>;
  /** Atomically claims the one-time welcome notes for this person; false if already claimed. */
  abstract claimWelcomeNotes(
    emailKey: string,
    tenantId: string,
  ): Promise<boolean>;
  abstract create(workspace: NewWorkspace): Promise<void>;
}
