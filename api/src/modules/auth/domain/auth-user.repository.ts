import { AuthUser } from './auth-user';

export abstract class IAuthUserRepository {
  abstract findById(id: string): Promise<AuthUser | null>;
  abstract findByIdsAndTenantId(
    ids: string[],
    tenantId: string,
  ): Promise<AuthUser[]>;
  abstract findByEmail(email: string): Promise<AuthUser | null>;
  abstract insertIfEmailAbsent(user: AuthUser): Promise<AuthUser | null>;
  abstract save(user: AuthUser): Promise<AuthUser>;
  abstract update(user: AuthUser): Promise<AuthUser>;
  abstract updateLastLoginAt(authUserId: string, at: Date): Promise<void>;
}
