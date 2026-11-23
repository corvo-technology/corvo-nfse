import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('platform_admin_audit_events')
export class PlatformAdminAuditOrmEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'uuid', name: 'actor_user_id' }) actorUserId!: string;
  @Column({ type: 'text', name: 'actor_email' }) actorEmail!: string;
  @Column({ type: 'varchar', length: 40 }) action!: string;
  @Column({ type: 'uuid', name: 'target_tenant_id', nullable: true })
  targetTenantId!: string | null;
  @Column({ type: 'uuid', name: 'target_user_id', nullable: true })
  targetUserId!: string | null;
  @Column({ type: 'text', nullable: true }) reason!: string | null;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload!: Record<string, unknown>;
  @Column({ type: 'boolean' }) success!: boolean;
  @Column({
    type: 'varchar',
    length: 200,
    name: 'idempotency_key',
    nullable: true,
  })
  idempotencyKey!: string | null;
  @Column({ type: 'varchar', length: 64, name: 'ip_hash', nullable: true })
  ipHash!: string | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
