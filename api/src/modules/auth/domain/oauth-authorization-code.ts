export type CodeChallengeMethod = 'S256';

export type OAuthAuthorizationCode = {
  id: string;
  clientId: string;
  authUserId: string;
  productKey: string;
  codeHash: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  redirectUri: string;
  scope: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
