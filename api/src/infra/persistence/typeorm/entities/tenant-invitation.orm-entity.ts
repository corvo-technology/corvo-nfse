import {
  ForeignKey,
  Index,
  Check,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_invitations')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_tenant_invitations_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_tenant_invitations_pending_email', ['tenantId', 'email'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('idx_tenant_invitations_token_hash', ['tokenHash'], {
  unique: true,
  where: '"token_hash" IS NOT NULL',
})
@Check(
  'chk_tenant_invitations_status',
  `"status" IN ('pending', 'completed', 'revoked', 'expired')`,
)
export class TenantInvitationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 50, default: 'admin' })
  role!: string;

  @Column('text', { array: true, default: () => "'{}'" })
  permissions!: string[];

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, nullable: true })
  tokenHash?: string | null;

  @Column({ name: 'invited_by_user_id', type: 'uuid', nullable: true })
  invitedByUserId?: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt?: Date | null;

  @Column({ name: 'accepted_by_user_id', type: 'uuid', nullable: true })
  acceptedByUserId?: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
