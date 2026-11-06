import { CursorQuery } from '@/shared/http/pagination';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthContext } from '../auth/auth-context';
import { IAuthAuditEventRepository } from '../auth/domain/auth-audit-event.repository';
import { IAuthSessionRepository } from '../auth/domain/auth-session.repository';
import { IAuthUserRepository } from '../auth/domain/auth-user.repository';
import { IOAuthClientRepository } from '../auth/domain/oauth-client.repository';
import { ITenantMembershipRepository } from '../auth/domain/tenant-membership.repository';
import type { McpConnection } from './domain/mcp-connection';
import {
  MCP_CONNECTION_REPOSITORY,
  type McpConnectionRepository,
} from './domain/mcp-connection.repository';

/** Product key used by every Corvo web flow (see AuthContextService). */
const PRODUCT_KEY = 'corvo';

export interface ConnectionListItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  client_name: string;
  scopes: string[];
  environment: 'test' | 'live';
  granted_at: string;
  last_used_at: string | null;
  tool_calls: number;
  invoices_issued: number;
  revoked: boolean;
  /** True when the connection belongs to the requesting user. */
  mine: boolean;
  /** Who granted it; shown to admins so they can tell connections apart. */
  owner_email: string | null;
}

/**
 * Dashboard-facing connection management. Members see and revoke their own
 * connections; members with `settings.manage` (admins) see and revoke every
 * connection of the workspace. Revoking invalidates the backing auth session
 * and records an audit event.
 *
 * Distinct from `POST /mcp/revoke` in McpOAuthController, the RFC 7009
 * endpoint the MCP client itself calls with its refresh token.
 */
@Injectable()
export class McpConnectionService {
  constructor(
    @Inject(MCP_CONNECTION_REPOSITORY)
    private readonly repo: McpConnectionRepository,
    @Inject(IAuthSessionRepository)
    private readonly sessionRepo: IAuthSessionRepository,
    @Inject(IAuthAuditEventRepository)
    private readonly auditRepo: IAuthAuditEventRepository,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
    @Inject(IOAuthClientRepository)
    private readonly clients: IOAuthClientRepository,
    @Inject(IAuthUserRepository)
    private readonly users: IAuthUserRepository,
  ) {}

  async listPage(auth: AuthContext, options: CursorQuery) {
    const admin = this.canManageAll(auth);
    const page = await this.repo.listPage(
      admin ? null : auth.authUserId,
      auth.activeTenantId,
      options,
    );
    const rows = page.data;
    const [tenantNames, clientNames, emails] = await Promise.all([
      this.tenantNames(auth.authUserId),
      this.clientNames(rows),
      admin
        ? this.ownerEmails(rows, auth.activeTenantId)
        : Promise.resolve(new Map<string, string>()),
    ]);
    return page.map(
      (connection): ConnectionListItem => ({
        id: connection.id,
        tenant_id: connection.tenantId,
        tenant_name: tenantNames.get(connection.tenantId) ?? 'Unknown',
        client_name: clientNames.get(connection.clientId) ?? 'Aplicativo de IA',
        scopes: connection.scopes,
        environment: connection.environment,
        granted_at: connection.grantedAt.toISOString(),
        last_used_at: connection.lastUsedAt?.toISOString() ?? null,
        tool_calls: connection.toolCallsCount,
        invoices_issued: connection.invoicesIssuedCount,
        revoked: connection.revokedAt !== null,
        mine: connection.authUserId === auth.authUserId,
        owner_email: emails.get(connection.authUserId) ?? null,
      }),
    );
  }

  async revoke(id: string, auth: AuthContext): Promise<void> {
    const connection = await this.repo.findById(id, auth.activeTenantId);
    if (!connection)
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found',
      });
    if (connection.authUserId !== auth.authUserId && !this.canManageAll(auth)) {
      // Same answer as a missing row: do not reveal other members' connections.
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found',
      });
    }
    if (connection.revokedAt) return;

    await Promise.all([
      this.repo.revoke(id, auth.activeTenantId, connection.authUserId),
      this.sessionRepo.revokeTenantSession(
        connection.sessionId,
        connection.tenantId,
        connection.authUserId,
      ),
    ]);

    await this.auditRepo.save({
      id: randomUUID(),
      authUserId: auth.authUserId,
      eventType: 'mcp_connection_revoked',
      clientId: connection.clientId,
      sessionId: connection.sessionId,
      ipHash: null,
      userAgent: null,
      metadata: {
        connection_id: id,
        tenant_id: connection.tenantId,
        owner_auth_user_id: connection.authUserId,
        active_tenant_id: auth.activeTenantId,
      },
      createdAt: new Date(),
    });
  }

  private canManageAll(auth: AuthContext): boolean {
    return auth.permissions.includes('settings.manage');
  }

  /** The `tenants` table carries no display name; memberships do. */
  private async tenantNames(userId: string): Promise<Map<string, string>> {
    const rows =
      await this.memberships.listActiveWithEstablishmentByAuthUserAndProduct(
        userId,
        PRODUCT_KEY,
      );
    return new Map(rows.map((m) => [m.tenantId, m.establishmentName]));
  }

  private async clientNames(
    rows: McpConnection[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.clientId))];
    const found = await Promise.all(ids.map((id) => this.clients.findById(id)));
    return new Map(
      found.flatMap((client) => (client ? [[client.id, client.name]] : [])),
    );
  }

  private async ownerEmails(
    rows: McpConnection[],
    tenantId: string,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.authUserId))];
    if (ids.length === 0) return new Map();
    const users = await this.users.findByIdsAndTenantId(ids, tenantId);
    return new Map(users.map((user) => [user.id, user.email]));
  }
}
