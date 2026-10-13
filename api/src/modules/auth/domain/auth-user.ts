import { AuthIdentityProvider } from './auth-identity';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  primaryIdentityType: AuthIdentityProvider | null;
  createdAt: Date;
  updatedAt: Date;
};
