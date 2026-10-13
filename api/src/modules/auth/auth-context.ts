import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
export type UserRole =
  | 'admin'
  | 'manager'
  | 'professional'
  | 'developer'
  | 'billing';

export type AuthorizationPrincipal = 'tenant_member' | 'api_key';

export type AvailableTenant = {
  tenantId: string;
  membershipId: string;
  role: UserRole;
  establishmentName: string;
};

export type AuthContext = {
  /** Distinguishes a human membership from a scoped API credential. */
  principalType?: AuthorizationPrincipal;
  authUserId: string;
  productKey: string;
  /**
   * Legacy identifier used by older tenant flows. In tenant contexts this is
   * tenant_memberships.id; do not persist it into auth_users foreign keys.
   */
  userId: string;
  tenantId: string;
  activeTenantId: string;
  role: UserRole;
  contextType: 'platform' | 'tenant';
  platformRole: string | null;
  platformPermissions: string[];
  permissions: string[];
  professionalId?: string;
  isPlatformAdmin: boolean;
  platformUserId?: string;
  pixKeyRegistered?: boolean;
  availableTenants?: AvailableTenant[];
  membershipId?: string;
  membershipStatus?: 'active' | 'inactive' | null;
  sessionId?: string;
  clientId?: string;
  scope?: string;
  /** The API credential determines the execution environment. */
  apiKeyEnvironment?: ExecutionEnvironment;
  executionEnvironment?: ExecutionEnvironment;
};

export type PublicContext = {
  tenantId: string;
  source: 'public-booking' | 'whatsapp' | 'payment-webhook' | 'waitlist';
  verified: boolean;
};

export type RequestWithAuthContext = {
  authContext?: AuthContext;
  publicContext?: PublicContext;
  params?: Record<string, string | undefined>;
};
