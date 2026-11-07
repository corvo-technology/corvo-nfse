import { TenantMembershipRole } from './tenant-membership';
import type { TenantPermission } from './permission';

export type TenantInvitationStatus =
  'pending' | 'completed' | 'revoked' | 'expired';

export interface TenantInvitation {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: TenantMembershipRole;
  permissions: TenantPermission[];
  status: TenantInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InviteProfessionalProfileInput {
  name: string;
  email: string;
  role?: TenantMembershipRole;
}

export interface InviteProfessionalInput extends InviteProfessionalProfileInput {
  tenantId: string;
  expiresAt?: Date;
}
