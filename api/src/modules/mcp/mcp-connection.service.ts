import { CursorQuery } from '@/shared/http/pagination';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthContext } from '../auth/auth-context';
import { IAuthAuditEventRepository } from '../auth/domain/auth-audit-event.repository';
import { IAuthSessionRepository } from '../auth/domain/auth-session.repository';
import { ITenantMembershipRepository } from '../auth/domain/tenant-membership.repository';
import type { McpConnectionOrmEntity } from './infra/mcp-connection.orm-entity';
import type { McpConnectionRepository } from './infra/mcp-connection.repository';
import { TypeOrmMcpConnectionRepository } from './infra/mcp-connection.repository';

/** Product key used by every Corvo web flow (see AuthContextService). */
const PRODUCT_KEY = 'corvo';

export interface ConnectionListItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

/**
 * Dashboard-facing connection management: list the MCP connections granted by
 * a user and revoke one (invalidating the backing auth session and recording
 * an audit event).
 *
 * Note this is distinct from `POST /mcp/revoke` in McpOAuthController, which
 * is the machine-to-machine RFC 7009 endpoint that revokes by refresh token
 * on behalf of the MCP client itself.
 */
@Injectable()
export class McpConnectionService {
  async listPage(userId: string, tenantId: string, options: CursorQuery) {
    const connections = await this.repo.listPage(userId, tenantId, options);
    const memberships =
      await this.memberships.listActiveWithEstablishmentByAuthUserAndProduct(
        userId,
        PRODUCT_KEY,
      );
    const names = new Map(
      memberships.map((m) => [m.tenantId, m.establishmentName]),
    );
    return connections.map((connection) => this.toListItem(connection, names));
  }

  constructor(
    // McpConnectionRepository is a TypeScript interface (erased at runtime),
    // so the concrete TypeORM implementation is the injection token.
    @Inject(TypeOrmMcpConnectionRepository)
    private readonly repo: McpConnectionRepository,
    @Inject(IAuthSessionRepository)
    private readonly sessionRepo: IAuthSessionRepository,
    @Inject(IAuthAuditEventRepository)
    private readonly auditRepo: IAuthAuditEventRepository,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
  ) {}

  async listForUser(
    userId: string,
    tenantId: string,
  ): Promise<ConnectionListItem[]> {
    const [connections, activeMemberships] = await Promise.all([
      this.repo.findAllByUserAndTenant(userId, tenantId),
      this.memberships.listActiveWithEstablishmentByAuthUserAndProduct(
        userId,
        PRODUCT_KEY,
      ),
    ]);
    // The `tenants` table carries no display name; the establishment name
    // attached to the user's memberships is the tenant label surfaced
    // everywhere else (AuthContext.availableTenants, consent page).
    const tenantNames = new Map(
      activeMemberships.map((membership) => [
        membership.tenantId,
        membership.establishmentName,
      ]),
    );
    return connections.map((connection) =>
      this.toListItem(connection, tenantNames),
    );
  }

  async revoke(
    id: string,
    userId: string,
    authContext: AuthContext,
  ): Promise<void> {
    const connection = await this.repo.findByIdAndOwner(
      id,
      authContext.activeTenantId,
      userId,
    );
    if (!connection || connection.authUserId !== userId) {
      throw new NotFoundException('Connection not found');
    }

    await Promise.all([
      this.repo.revoke(id, authContext.activeTenantId, userId),
      this.revokeAuthSession(connection.sessionId, connection.tenantId, userId),
    ]);

    await this.auditRepo.save({
      id: randomUUID(),
      authUserId: userId,
      eventType: 'mcp_connection_revoked',
      clientId: connection.clientId,
      sessionId: connection.sessionId,
      ipHash: null,
      userAgent: null,
      metadata: {
        connection_id: id,
        tenant_id: connection.tenantId,
        active_tenant_id: authContext.activeTenantId,
      },
      createdAt: new Date(),
    });
  }

  /** Idempotent: a missing or already-revoked session is a no-op. */
  private async revokeAuthSession(
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.sessionRepo.revokeTenantSession(sessionId, tenantId, userId);
  }

  private toListItem(
    connection: McpConnectionOrmEntity,
    tenantNames: Map<string, string>,
  ): ConnectionListItem {
    return {
      id: connection.id,
      tenant_id: connection.tenantId,
      tenant_name: tenantNames.get(connection.tenantId) || 'Unknown',
      scopes: connection.scopes,
      granted_at: connection.grantedAt.toISOString(),
      last_used_at: connection.lastUsedAt?.toISOString() ?? null,
      revoked: connection.revokedAt !== null,
    };
  }
}
