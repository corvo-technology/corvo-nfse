export interface McpConnection {
  id: string;
  authUserId: string;
  tenantId: string;
  clientId: string;
  sessionId: string;
  scopes: string[];
  grantedAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}
