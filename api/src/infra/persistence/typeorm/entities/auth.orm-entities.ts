import {
  ForeignKey,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'auth_users' })
@Index('idx_auth_users_email', ['email'], { unique: true })
export class AuthUserOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ name: 'primary_identity_type', type: 'text', nullable: true })
  primaryIdentityType!: string | null;

  /** Written once by the marketing signup-attribution endpoint; never by the auth flows. */
  @Column({ name: 'signup_attribution', type: 'jsonb', nullable: true })
  signupAttribution!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'auth_sessions' })
@Index('idx_auth_sessions_auth_user', ['authUserId'])
@Index('idx_auth_sessions_refresh_hash', ['refreshTokenHash'], { unique: true })
@Index('idx_auth_sessions_session_hash', ['sessionTokenHash'], { unique: true })
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'fk_auth_sessions_user',
  onDelete: 'CASCADE',
})
@ForeignKey('AuthOAuthClientOrmEntity', ['clientId'], ['id'], {
  name: 'fk_auth_sessions_client',
  onDelete: 'RESTRICT',
})
@Index('idx_auth_sessions_client_id', ['clientId'])
@Index('uq_auth_sessions_one_active_web_per_user', ['authUserId'], {
  unique: true,
  where: `"kind" = 'web' AND "revoked_at" IS NULL`,
})
@Index(
  'idx_auth_sessions_active_user_kind',
  ['authUserId', 'kind', 'expiresAt'],
  { where: `"revoked_at" IS NULL` },
)
@Check('chk_auth_sessions_kind', `"kind" IN ('oauth_refresh', 'web')`)
@Check(
  'chk_auth_sessions_secret_kind',
  `("kind" = 'oauth_refresh' AND "refresh_token_hash" IS NOT NULL AND "session_token_hash" IS NULL) OR ("kind" = 'web' AND "session_token_hash" IS NOT NULL AND "refresh_token_hash" IS NULL)`,
)
export class AuthSessionOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'auth_user_id', type: 'uuid' })
  authUserId!: string;

  @Column({ name: 'client_id', type: 'text', default: 'corvo-web' })
  clientId!: string;

  @Column({ type: 'text', default: 'oauth_refresh' })
  kind!: 'oauth_refresh' | 'web';

  @Column({ name: 'refresh_token_hash', type: 'text', nullable: true })
  refreshTokenHash!: string | null;

  @Column({ name: 'session_token_hash', type: 'text', nullable: true })
  sessionTokenHash!: string | null;

  @Column({ name: 'active_tenant_id', type: 'uuid', nullable: true })
  activeTenantId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'auth_oauth_clients' })
export class AuthOAuthClientOrmEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'redirect_uris', type: 'text', array: true })
  redirectUris!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  scopes!: string[];

  @Column({ name: 'is_first_party', type: 'boolean', default: false })
  isFirstParty!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'token_endpoint_auth_method', type: 'text', default: 'none' })
  tokenEndpointAuthMethod!: string;

  @Column({
    name: 'grant_types',
    type: 'text',
    array: true,
    default: ['authorization_code'],
  })
  grantTypes!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'auth_authorization_codes' })
@Index('idx_auth_authorization_codes_code_hash', ['codeHash'], { unique: true })
@Index('idx_auth_authorization_codes_client_user', ['clientId', 'authUserId'])
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'fk_auth_authorization_codes_user',
  onDelete: 'CASCADE',
})
@ForeignKey('AuthOAuthClientOrmEntity', ['clientId'], ['id'], {
  name: 'fk_auth_authorization_codes_client',
  onDelete: 'RESTRICT',
})
@Check(
  'chk_auth_authorization_codes_challenge_method',
  `"code_challenge_method" IN ('S256')`,
)
export class AuthAuthorizationCodeOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'client_id', type: 'text' })
  clientId!: string;

  @Column({ name: 'auth_user_id', type: 'uuid' })
  authUserId!: string;

  @Column({ name: 'product_key', type: 'text' })
  productKey!: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash!: string;

  @Column({ name: 'code_challenge', type: 'text' })
  codeChallenge!: string;

  @Column({ name: 'code_challenge_method', type: 'text' })
  codeChallengeMethod!: string;

  @Column({ name: 'redirect_uri', type: 'text' })
  redirectUri!: string;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text', default: 'test' })
  environment!: 'test' | 'live';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'auth_audit_events' })
@Index('idx_auth_audit_events_auth_user_created', ['authUserId', 'createdAt'])
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'fk_auth_audit_events_user',
  onDelete: 'SET NULL',
})
@ForeignKey('AuthSessionOrmEntity', ['sessionId'], ['id'], {
  name: 'fk_auth_audit_events_session',
  onDelete: 'SET NULL',
})
@Index('idx_auth_audit_events_session_id', ['sessionId'], {
  where: `"session_id" IS NOT NULL`,
})
export class AuthAuditEventOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'auth_user_id', type: 'uuid', nullable: true })
  authUserId!: string | null;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'client_id', type: 'text', nullable: true })
  clientId!: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId!: string | null;

  @Column({ name: 'ip_hash', type: 'text', nullable: true })
  ipHash!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const AUTH_ORM_ENTITIES = [
  AuthUserOrmEntity,
  AuthSessionOrmEntity,
  AuthOAuthClientOrmEntity,
  AuthAuthorizationCodeOrmEntity,
  AuthAuditEventOrmEntity,
];
