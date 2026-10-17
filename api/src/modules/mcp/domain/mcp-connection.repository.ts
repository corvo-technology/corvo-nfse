import type { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { McpConnection } from './mcp-connection';

export const MCP_CONNECTION_REPOSITORY = 'MCP_CONNECTION_REPOSITORY';

export interface McpConnectionRepository {
  insert(connection: McpConnection, tenantId: string): Promise<void>;
  findBySession(
    sessionId: string,
    tenantId: string,
    userId: string,
    clientId: string,
  ): Promise<McpConnection | null>;
  /** `userId` null lists every connection of the workspace (admins). */
  listPage(
    userId: string | null,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<McpConnection>>;
  findById(id: string, tenantId: string): Promise<McpConnection | null>;
  findAnyByUserTenantClient(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnection | null>;
  reconnect(
    id: string,
    tenantId: string,
    next: {
      authUserId: string;
      sessionId: string;
      scopes: string[];
      environment: 'test' | 'live';
    },
  ): Promise<McpConnection>;
  recordUsage(
    id: string,
    tenantId: string,
    usage: { toolCalls: number; invoicesIssued: number },
  ): Promise<void>;
  findByIdAndOwner(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<McpConnection | null>;
  findActiveByUserAndTenant(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnection | null>;
  findAllByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<McpConnection[]>;
  save(connection: McpConnection, tenantId: string): Promise<McpConnection>;
  revoke(id: string, tenantId: string, userId: string): Promise<void>;
  touchLastUsed(id: string, tenantId: string, userId: string): Promise<void>;
}
