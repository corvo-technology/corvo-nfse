export type CodeChallengeMethod = 'S256';

export type OAuthAuthorizationCode = {
  id: string;
  clientId: string;
  authUserId: string;
  productKey: string;
  tenantId: string | null;
  codeHash: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  redirectUri: string;
  scope: string;
  /** Fiscal environment the MCP connection will operate in. */
  environment: 'test' | 'live';
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
