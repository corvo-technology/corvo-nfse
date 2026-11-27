import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('lifecycle_email_sends')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'lifecycle_email_sends_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Check(
  'ck_lifecycle_email_sends_kind',
  `kind IN ('first-invoice', 'monthly-summary', 'payment-pending')`,
)
@Index(
  'uq_lifecycle_email_sends_tenant_kind_period',
  ['tenantId', 'kind', 'period'],
  { unique: true },
)
@Index('idx_lifecycle_email_sends_tenant_created', ['tenantId', 'createdAt'])
export class LifecycleEmailSendOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 30 }) kind!: string;
  @Column({ type: 'varchar', length: 64 }) period!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
