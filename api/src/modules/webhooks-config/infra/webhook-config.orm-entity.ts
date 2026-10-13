import { Index as ManagedIndex } from 'typeorm';
import { Unique } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('webhook_configs')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_webhook_configs_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_webhook_configs_tenant', ['tenantId'])
@Unique('uq_webhook_configs_id_tenant', ['id', 'tenantId'])
@ManagedIndex('idx_webhook_configs_cursor', { synchronize: false })
export class WebhookConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', array: true })
  events!: string[];

  @Column({ type: 'varchar', length: 255 })
  secret!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
