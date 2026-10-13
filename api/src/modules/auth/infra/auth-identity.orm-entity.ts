import {
  ForeignKey,
  Check,
  UpdateDateColumn,
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('auth_identities')
@Index('idx_auth_identities_email', ['email'])
@Index('idx_auth_identities_user_provider', ['authUserId', 'provider'], {
  unique: true,
})
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'fk_auth_identities_user',
  onDelete: 'CASCADE',
})
@Index('idx_auth_identities_provider_user_id', ['provider', 'providerUserId'], {
  unique: true,
  where: `"provider_user_id" IS NOT NULL`,
})
@Check(
  'ck_auth_identities_provider',
  `"provider" IN ('github', 'google', 'email')`,
)
export class AuthIdentityOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'auth_user_id', type: 'uuid' })
  @Index('idx_auth_identities_auth_user_id')
  authUserId!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ name: 'provider_user_id', type: 'text', nullable: true })
  providerUserId?: string | null;

  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'text', nullable: true })
  name?: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl?: string | null;

  @Column({ name: 'access_token_encrypted', type: 'text', nullable: true })
  accessTokenEncrypted?: string | null;

  @Column({ name: 'refresh_token_encrypted', type: 'text', nullable: true })
  refreshTokenEncrypted?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'linked_at', type: 'timestamptz', default: () => 'now()' })
  linkedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
