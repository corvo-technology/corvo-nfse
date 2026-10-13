export type AuthAuditEventType =
  | 'login'
  | 'login_failed'
  | 'token_issued'
  | 'token_refreshed'
  | 'token_revoked'
  | 'mcp_connection_revoked';

export type AuthAuditEvent = {
  id: string;
  authUserId: string | null;
  eventType: AuthAuditEventType;
  clientId: string | null;
  sessionId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};
