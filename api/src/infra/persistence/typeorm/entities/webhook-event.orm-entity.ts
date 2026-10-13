import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WebhookEventStatus } from '@/modules/webhooks-config/domain/webhook-event.repository';

@Entity({ name: 'webhook_events' })
@Check(
  'ck_webhook_events_status',
  `"status" IN ('received', 'processing', 'processed', 'ignored', 'failed', 'manual_review')`,
)
@Check('ck_webhook_events_attempts', '"attempts" >= 0')
@Check(
  'ck_webhook_events_payload_sha256',
  `"payload_sha256" ~ '^[0-9a-f]{64}$'`,
)
@Index('uq_webhook_events_provider_event', ['provider', 'providerEventId'], {
  unique: true,
})
@Index('idx_webhook_events_pending', ['status', 'availableAt', 'receivedAt'], {
  where: `"status" IN ('received', 'failed')`,
})
@Index('idx_webhook_events_expired_lease', ['leaseUntil'], {
  where: `"status" = 'processing' AND "lease_until" IS NOT NULL`,
})
@Index('idx_webhook_events_tenant_received', ['tenantId', 'receivedAt'])
@Index('idx_webhook_events_provider_type_received', [
  'provider',
  'eventType',
  'receivedAt',
])
export class WebhookEventOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ name: 'provider_event_id', type: 'text' })
  providerEventId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'external_resource_id', type: 'text', nullable: true })
  externalResourceId!: string | null;

  @Column({ name: 'processing_kind', type: 'text', nullable: true })
  processingKind!: string | null;

  @Column({ name: 'delivery_target', type: 'text', nullable: true })
  deliveryTarget!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'payload_sha256', type: 'text' })
  payloadSha256!: string;

  @Column({ type: 'text' })
  status!: WebhookEventStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
