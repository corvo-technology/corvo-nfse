export type AuthSession = {
  id: string;
  authUserId: string;
  clientId: string;
  refreshTokenHash: string | null;
  kind: 'oauth_refresh' | 'web';
  sessionTokenHash: string | null;
  activeTenantId: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
