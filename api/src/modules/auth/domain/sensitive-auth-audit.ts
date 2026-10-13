export type SensitiveAuthAuditAction =
  | 'auth.active_tenant_changed'
  | 'auth.membership.created'
  | 'auth.membership.permissions_updated'
  | 'auth.membership.deactivated'
  | 'auth.membership.reactivated'
  | 'auth.invitation.created'
  | 'auth.invitation.revoked'
  | 'auth.invitation.resent'
  | 'auth.invitation.renewed'
  | 'auth.professional_onboarding.completed'
  | 'auth.establishment_owner_onboarding.completed'
  | 'auth.public_establishment_signup.completed'
  | 'auth.professional_access_changed'
  | 'auth.owner_booking_availability_enabled'
  | 'auth.owner_booking_availability_disabled';

export interface SensitiveAuthAuditEvent {
  id: string;
  actorAuthUserId: string;
  actorMembershipId?: string;
  tenantId?: string;
  action: SensitiveAuthAuditAction;
  targetType: 'membership' | 'invitation' | 'tenant' | 'professional';
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
