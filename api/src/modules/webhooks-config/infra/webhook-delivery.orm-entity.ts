import { Index as ManagedIndex } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('webhook_deliveries')
@ForeignKey(
  'WebhookConfigEntity',
  ['webhookConfigId', 'tenantId'],
  ['id', 'tenantId'],
  { name: 'fk_webhook_delivery_config_tenant' },
)
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_webhook_deliveries_tenant',
  onDelete: 'CASCADE',
})
@ForeignKey('WebhookConfigEntity', ['webhookConfigId'], ['id'], {
  name: 'fk_webhook_deliveries_config',
  onDelete: 'CASCADE',
})
@Index('idx_webhook_deliveries_tenant_created_at', ['tenantId', 'createdAt'])
@Index('idx_webhook_deliveries_retry', ['status', 'nextRetryAt'])
@Index('idx_webhook_deliveries_finished', ['createdAt'], {
  where: "status IN ('sent','failed')",
})
@ManagedIndex('idx_webhook_deliveries_cursor', { synchronize: false })
@ManagedIndex('idx_webhook_deliveries_invoice', { synchronize: false })
@ManagedIndex('idx_webhook_deliveries_document', { synchronize: false })
export class WebhookDeliveryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'webhook_config_id', type: 'uuid' })
  webhookConfigId!: string;

  /** The invoice the event is about, when there is one. */
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId?: string | null;

  /** The NF-e the event is about, when there is one (`invoice_id` stays null for it). */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId?: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 10, default: 'live' })
  environment!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @Column({ name: 'status_code', type: 'integer', nullable: true })
  statusCode?: number;

  @Column({ name: 'response_body', type: 'text', nullable: true })
  responseBody?: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs?: number;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt?: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
