import { AuthIdentity, AuthIdentityProvider } from './auth-identity';

export const AUTH_IDENTITY_REPOSITORY = Symbol('IAuthIdentityRepository');

export abstract class IAuthIdentityRepository {
  abstract findById(id: string): Promise<AuthIdentity | null>;
  abstract findByUserId(userId: string): Promise<AuthIdentity[]>;
  abstract findByEmail(email: string): Promise<AuthIdentity | null>;
  abstract findByProviderAndEmail(
    provider: AuthIdentityProvider,
    email: string,
  ): Promise<AuthIdentity | null>;
  abstract findByProviderAndProviderUserId(
    provider: AuthIdentityProvider,
    providerUserId: string,
  ): Promise<AuthIdentity | null>;
  abstract save(identity: AuthIdentity): Promise<AuthIdentity>;
  abstract update(identity: AuthIdentity): Promise<AuthIdentity>;
  abstract delete(id: string): Promise<void>;
}
