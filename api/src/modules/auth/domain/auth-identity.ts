export type AuthIdentityProvider = 'github' | 'google' | 'email';

export interface AuthIdentityProps {
  id: string;
  authUserId: string;
  provider: AuthIdentityProvider;
  providerUserId: string | null;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthIdentity {
  readonly id: string;
  readonly authUserId: string;
  readonly provider: AuthIdentityProvider;
  readonly providerUserId: string | null;
  readonly email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  readonly linkedAt: Date;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: AuthIdentityProps) {
    this.id = props.id;
    this.authUserId = props.authUserId;
    this.provider = props.provider;
    this.providerUserId = props.providerUserId;
    this.email = props.email;
    this.emailVerified = props.emailVerified;
    this.name = props.name;
    this.avatarUrl = props.avatarUrl;
    this.linkedAt = props.linkedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(input: {
    authUserId: string;
    provider: AuthIdentityProvider;
    providerUserId: string | null;
    email: string;
    emailVerified: boolean;
    name: string | null;
    avatarUrl: string | null;
  }): AuthIdentity {
    const now = new Date();
    return new AuthIdentity({
      id: crypto.randomUUID(),
      authUserId: input.authUserId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      email: input.email,
      emailVerified: input.emailVerified,
      name: input.name,
      avatarUrl: input.avatarUrl,
      linkedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: AuthIdentityProps): AuthIdentity {
    return new AuthIdentity(props);
  }

  toPersistence(): AuthIdentityProps {
    return {
      id: this.id,
      authUserId: this.authUserId,
      provider: this.provider,
      providerUserId: this.providerUserId,
      email: this.email,
      emailVerified: this.emailVerified,
      name: this.name,
      avatarUrl: this.avatarUrl,
      linkedAt: this.linkedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
