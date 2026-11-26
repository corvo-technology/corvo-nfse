import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthContext } from '../auth-context';
import { ApiKeyEnvironment, ApiKeyScope } from '../domain/api-key';
import {
  TenantAccessDeniedError,
  TenantMembershipInactiveError,
  TenantMembershipNotFoundError,
} from '../domain/errors';
import {
  TenantPermission,
  permissionsForTenantRole,
} from '../domain/permission';
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import { AuthContextCacheService } from './auth-context-cache.service';

@Injectable()
export class AuthContextService {
  private readonly inFlightContexts = new Map<string, Promise<AuthContext>>();
  constructor(
    @Inject(ITenantMembershipRepository)
    private readonly membershipRepository: ITenantMembershipRepository,
    @Optional() private readonly contextCache?: AuthContextCacheService,
  ) {}

  async buildForAuthUser(
    authUserId: string,
    productKey: string,
    activeTenantId?: string,
  ): Promise<AuthContext> {
    const key = `${authUserId}:${productKey}:${activeTenantId ?? 'default'}`;
    const existing = this.inFlightContexts.get(key);
    if (existing) return existing;

    const context = this.resolveAuthUserContext(
      authUserId,
      productKey,
      activeTenantId,
    );
    this.inFlightContexts.set(key, context);
    try {
      return await context;
    } finally {
      this.inFlightContexts.delete(key);
    }
  }

  private async resolveAuthUserContext(
    authUserId: string,
    productKey: string,
    activeTenantId?: string,
  ): Promise<AuthContext> {
    const cached = await this.contextCache?.get(
      authUserId,
      productKey,
      activeTenantId,
    );
    if (cached) return cached;

    const memberships =
      await this.membershipRepository.listActiveWithEstablishmentByAuthUserAndProduct(
        authUserId,
        productKey,
      );
    const selected = activeTenantId
      ? memberships.find((membership) => membership.tenantId === activeTenantId)
      : (memberships.find((membership) => membership.tenantId === authUserId) ??
        memberships[0]);

    if (!selected) {
      if (activeTenantId) {
        throw new TenantAccessDeniedError();
      }
      throw new TenantMembershipNotFoundError();
    }
    if (!selected.isActive) {
      throw new TenantMembershipInactiveError();
    }

    const context: AuthContext = {
      principalType: 'tenant_member',
      authUserId,
      productKey,
      userId: selected.id,
      tenantId: selected.tenantId,
      activeTenantId: selected.tenantId,
      role: selected.role,
      contextType: 'tenant',
      platformRole: null,
      platformPermissions: [],
      permissions: permissionsForTenantRole(selected.role),
      isPlatformAdmin: false,
      availableTenants: memberships.map((membership) => ({
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: membership.role,
        establishmentName: membership.establishmentName,
      })),
      membershipId: selected.id,
      membershipStatus: 'active',
    };
    await this.contextCache?.set(
      authUserId,
      productKey,
      activeTenantId,
      context,
    );
    return context;
  }

  /**
   * Build an {@link AuthContext} for an API-key-authenticated request.
   *
   * API keys are not tied to a specific user or product; the context is
   * constructed purely from the tenant and scope attached to the key.
   */
  buildForApiKey(
    tenantId: string,
    scope: ApiKeyScope,
    environment: ApiKeyEnvironment = 'live',
  ): AuthContext {
    const permissions = permissionsForApiKeyScope(scope);
    return {
      principalType: 'api_key',
      authUserId: 'api-key',
      productKey: 'api-key',
      userId: 'api-key',
      tenantId,
      activeTenantId: tenantId,
      role: 'admin',
      contextType: 'tenant',
      platformRole: null,
      platformPermissions: [],
      permissions,
      isPlatformAdmin: false,
      membershipStatus: 'active',
      apiKeyEnvironment: environment,
    };
  }
}

const FULL_ACCESS_PERMISSIONS: TenantPermission[] = [
  'credits.view',
  'credits.manage',
  'webhooks.view',
  'webhooks.manage',
  'integrations.view',
  'integrations.manage',
  'api_keys.manage',
  'settings.manage',
  'billing.view',
  'billing.manage',
  'nfse.companies.view',
  'nfse.companies.manage',
  'nfse.certificates.view',
  'nfse.certificates.manage',
  'nfse.invoices.view',
  'nfse.invoices.issue',
  'nfe.documents.view',
  'nfe.documents.issue',
  'nfe.documents.manage',
];

const INVOICES_READ_WRITE_PERMISSIONS: TenantPermission[] = [
  'nfse.invoices.view',
  'nfse.invoices.issue',
  'nfse.companies.view',
  'nfse.certificates.view',
  'webhooks.view',
  'nfe.documents.view',
  'nfe.documents.issue',
  'nfe.documents.manage',
];

const INVOICES_ISSUE_PERMISSIONS: TenantPermission[] = [
  'nfse.invoices.issue',
  'nfe.documents.issue',
];

const INVOICES_VIEW_PERMISSIONS: TenantPermission[] = [
  'nfse.invoices.view',
  'nfe.documents.view',
];

export function permissionsForApiKeyScope(
  scope: ApiKeyScope,
): TenantPermission[] {
  switch (scope) {
    case 'full_access':
      return [...FULL_ACCESS_PERMISSIONS];
    case 'invoices_read_write':
      return [...INVOICES_READ_WRITE_PERMISSIONS];
    case 'invoices_issue':
      return [...INVOICES_ISSUE_PERMISSIONS];
    case 'invoices_view':
      return [...INVOICES_VIEW_PERMISSIONS];
    default:
      return [];
  }
}
