import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('account_audit_events')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'account_audit_events_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_account_audit_events_environment', `environment IN ('test','live')`)
@Check(
  'ck_account_audit_events_actor_type',
  `actor_type IN ('user','agent','api_key','system')`,
)
@Check(
  'ck_account_audit_events_metadata_size',
  `pg_column_size(metadata) <= 4096`,
)
@Index('idx_account_audit_events_tenant_time', ['tenantId', 'occurredAt', 'id'])
export class AccountAuditEventOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 10, nullable: true })
  environment!: string | null;
  @Column({
    name: 'occurred_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  occurredAt!: Date;
  @Column({ name: 'actor_type', type: 'varchar', length: 10 })
  actorType!: string;
  @Column({ name: 'actor_id', type: 'text', nullable: true })
  actorId!: string | null;
  @Column({ name: 'actor_label', type: 'varchar', length: 200 })
  actorLabel!: string;
  @Column({
    name: 'actor_on_behalf_of_label',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  actorOnBehalfOfLabel!: string | null;
  @Column({ type: 'varchar', length: 64 }) action!: string;
  @Column({ name: 'target_type', type: 'varchar', length: 32, nullable: true })
  targetType!: string | null;
  @Column({ name: 'target_id', type: 'text', nullable: true })
  targetId!: string | null;
  @Column({
    name: 'target_label',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  targetLabel!: string | null;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  metadata!: Record<string, string | number | boolean | null>;
  @Column({ name: 'ip_hash', type: 'varchar', length: 64, nullable: true })
  ipHash!: string | null;
}
