export interface McpConnection {
  id: string;
  authUserId: string;
  tenantId: string;
  clientId: string;
  sessionId: string;
  scopes: string[];
  environment: 'test' | 'live';
  grantedAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  toolCallsCount: number;
  invoicesIssuedCount: number;
}
