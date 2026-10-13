import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { TenantMembership } from './tenant-membership';

export type TenantMembershipListOrderBy = 'created_at';
export type TenantMembershipListOrder = 'asc' | 'desc';

export type TenantMembershipWithEmail = TenantMembership & {
  email: string;
  lastLoginAt: Date | null;
};

export type TenantMembershipWithEstablishmentName = TenantMembership & {
  establishmentName: string;
};

export type TenantMembershipListOptions = {
  tenantIds?: string[];
  authUserIds?: string[];
  orderBy: TenantMembershipListOrderBy;
  order: TenantMembershipListOrder;
};

export abstract class ITenantMembershipRepository {
  abstract listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<TenantMembership>>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<TenantMembership | null>;
  abstract findByAuthUserAndTenant(
    authUserId: string,
    tenantId: string,
  ): Promise<TenantMembership | null>;
  abstract listActiveByAuthUser(
    authUserId: string,
  ): Promise<TenantMembership[]>;
  abstract listActiveByAuthUserAndProduct(
    authUserId: string,
    productKey: string,
  ): Promise<TenantMembership[]>;
  abstract listActiveWithEstablishmentByAuthUserAndProduct(
    authUserId: string,
    productKey: string,
  ): Promise<TenantMembershipWithEstablishmentName[]>;
  abstract findByAuthUserTenantAndProduct(
    authUserId: string,
    tenantId: string,
    productKey: string,
  ): Promise<TenantMembership | null>;
  abstract listActiveByTenant(tenantId: string): Promise<TenantMembership[]>;
  abstract listByTenant(tenantId: string): Promise<TenantMembership[]>;
  abstract save(
    membership: TenantMembership,
    tenantId: string,
  ): Promise<TenantMembership>;
  abstract update(
    membership: TenantMembership,
    tenantId: string,
  ): Promise<TenantMembership>;
}
