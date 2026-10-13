import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_IDENTITY_REPOSITORY,
  IAuthIdentityRepository,
} from '../domain/auth-identity.repository';
import { AuthIdentity, AuthIdentityProvider } from '../domain/auth-identity';
import { AuthUser } from '../domain/auth-user';
import { AuthUserService } from './auth-user.service';

@Injectable()
export class AuthIdentityService {
  constructor(
    @Inject(AUTH_IDENTITY_REPOSITORY)
    private readonly identities: IAuthIdentityRepository,
    private readonly authUserService: AuthUserService,
  ) {}

  async findOrCreateUserByOAuth(input: {
    email: string;
    name: string | null;
    provider: AuthIdentityProvider;
    providerUserId: string;
    avatarUrl: string | null;
  }): Promise<{ user: AuthUser; isNew: boolean }> {
    // 1. Check if OAuth identity exists
    const existing = await this.identities.findByProviderAndProviderUserId(
      input.provider,
      input.providerUserId,
    );
    if (existing) {
      const user = await this.authUserService.findById(existing.authUserId);
      if (!user) throw new Error('User not found');
      return { user, isNew: false };
    }

    // 2. Check if user with this email exists
    const userByEmail = await this.authUserService.findByEmail(input.email);
    if (userByEmail) {
      // Link OAuth identity to existing user
      const identity = AuthIdentity.create({
        authUserId: userByEmail.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
        emailVerified: true, // OAuth provider verified
        name: input.name,
        avatarUrl: input.avatarUrl,
      });
      await this.identities.save(identity);
      // Also create/update email identity
      const emailIdentity = await this.identities.findByProviderAndEmail(
        'email',
        input.email,
      );
      if (!emailIdentity) {
        await this.identities.save(
          AuthIdentity.create({
            authUserId: userByEmail.id,
            provider: 'email',
            providerUserId: null,
            email: input.email,
            emailVerified: true,
            name: input.name,
            avatarUrl: null,
          }),
        );
      }
      return { user: userByEmail, isNew: false };
    }

    // 3. Create new user
    const newUser = await this.authUserService.createUser({
      email: input.email,
      name: input.name || input.email.split('@')[0],
    });

    // Create OAuth identity
    await this.identities.save(
      AuthIdentity.create({
        authUserId: newUser.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
        emailVerified: true,
        name: input.name,
        avatarUrl: input.avatarUrl,
      }),
    );

    // Create email identity
    await this.identities.save(
      AuthIdentity.create({
        authUserId: newUser.id,
        provider: 'email',
        providerUserId: null,
        email: input.email,
        emailVerified: true,
        name: input.name,
        avatarUrl: null,
      }),
    );

    await this.authUserService.setPrimaryIdentity(newUser.id, input.provider);
    return { user: newUser, isNew: true };
  }

  async findOrCreateUserByMagicLink(
    email: string,
  ): Promise<{ user: AuthUser; isNew: boolean }> {
    const existing = await this.authUserService.findByEmail(email);
    if (existing) {
      // Link email identity if not already
      const emailIdentity = await this.identities.findByProviderAndEmail(
        'email',
        email,
      );
      if (!emailIdentity) {
        await this.identities.save(
          AuthIdentity.create({
            authUserId: existing.id,
            provider: 'email',
            providerUserId: null,
            email,
            emailVerified: true,
            name: existing.name,
            avatarUrl: null,
          }),
        );
      }
      return { user: existing, isNew: false };
    }

    // Create new user
    const newUser = await this.authUserService.createUser({
      email,
      name: email.split('@')[0],
    });
    await this.identities.save(
      AuthIdentity.create({
        authUserId: newUser.id,
        provider: 'email',
        providerUserId: null,
        email,
        emailVerified: true,
        name: newUser.name,
        avatarUrl: null,
      }),
    );
    await this.authUserService.setPrimaryIdentity(newUser.id, 'email');
    return { user: newUser, isNew: true };
  }
}
