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
  listPage(
    userId: string,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<McpConnection>>;
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
