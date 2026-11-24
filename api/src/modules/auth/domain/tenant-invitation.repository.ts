import { TenantInvitation } from './tenant-invitation';

export abstract class ITenantInvitationRepository {
  abstract findPendingByEmailAndTenant(
    email: string,
    tenantId: string,
  ): Promise<TenantInvitation | null>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<TenantInvitation | null>;
  abstract listByTenant(tenantId: string): Promise<TenantInvitation[]>;
  /** Pending and not yet expired. */
  abstract listOpenByTenant(tenantId: string): Promise<TenantInvitation[]>;
  /** Pending, expired ones included, so an admin can still resend them. */
  abstract listPendingByTenant(tenantId: string): Promise<TenantInvitation[]>;
  /** Looks across tenants: run inside the invitation system scope. */
  abstract findByTokenHash(tokenHash: string): Promise<TenantInvitation | null>;
  /** Single-use: true only for the one caller that moves a live pending invitation to completed. */
  abstract claim(
    id: string,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<boolean>;
  abstract save(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation>;
  abstract update(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation>;
}
