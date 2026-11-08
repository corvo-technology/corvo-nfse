import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAuthUserRepository } from '../domain/auth-user.repository';
import { AuthUser } from '../domain/auth-user';
import { AuthIdentityProvider } from '../domain/auth-identity';

@Injectable()
export class AuthUserService {
  constructor(
    @Inject(IAuthUserRepository)
    private readonly users: IAuthUserRepository,
  ) {}

  async createUser(input: { email: string; name?: string }): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    const existing = await this.users.findByEmail(email);
    if (existing) return existing;

    const now = new Date();
    return this.users.save({
      id: randomUUID(),
      email,
      name: input.name || '',
      emailVerifiedAt: null,
      primaryIdentityType: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.users.findById(id);
  }

  findByEmail(email: string): Promise<AuthUser | null> {
    return this.users.findByEmail(normalizeEmail(email));
  }

  async getUsersByIds(
    ids: string[],
    tenantId: string,
  ): Promise<Map<string, AuthUser>> {
    const users = await this.users.findByIdsAndTenantId(ids, tenantId);
    const map = new Map<string, AuthUser>();
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }

  /** The name the person gave; an empty name means they were never asked. */
  async updateName(userId: string, name: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new Error('User not found');
    return this.users.update({
      ...user,
      name: name.trim(),
      updatedAt: new Date(),
    });
  }

  async markEmailVerified(
    userId: string,
    verifiedAt = new Date(),
  ): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return this.users.update({
      ...user,
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date(),
    });
  }

  async setPrimaryIdentity(
    userId: string,
    type: AuthIdentityProvider,
  ): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return this.users.update({
      ...user,
      primaryIdentityType: type,
      updatedAt: new Date(),
    });
  }

  async markLogin(authUserId: string, now = new Date()): Promise<void> {
    const user = await this.users.findById(authUserId);
    if (!user) return;
    await this.users.update({ ...user, updatedAt: now });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
