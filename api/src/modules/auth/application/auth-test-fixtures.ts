import { TenantInvitation } from '../domain/tenant-invitation';
import { TenantMembership } from '../domain/tenant-membership';

export const authNow = new Date('2026-06-04T00:00:00.000Z');

export function makeMembership(
  overrides: Partial<TenantMembership> = {},
): TenantMembership {
  return {
    id: 'membership-1',
    authUserId: 'auth-user-1',
    tenantId: 'tenant-1',
    role: 'developer',
    permissions: ['nfse.invoices.view'],
    isActive: true,
    createdAt: authNow,
    updatedAt: authNow,
    ...overrides,
  };
}

export function makeInvitation(
  overrides: Partial<TenantInvitation> = {},
): TenantInvitation {
  return {
    id: 'invitation-1',
    tenantId: 'tenant-1',
    email: 'pro@example.com',
    name: 'Profissional',
    role: 'developer',
    permissions: ['nfse.invoices.view'],
    status: 'pending',
    expiresAt: new Date('2026-06-11T00:00:00.000Z'),
    createdAt: authNow,
    updatedAt: authNow,
    ...overrides,
  };
}
