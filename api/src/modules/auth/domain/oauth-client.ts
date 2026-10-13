export type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  isFirstParty: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
