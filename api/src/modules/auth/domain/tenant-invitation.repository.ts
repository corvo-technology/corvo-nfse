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
  abstract save(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation>;
  abstract update(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation>;
}
