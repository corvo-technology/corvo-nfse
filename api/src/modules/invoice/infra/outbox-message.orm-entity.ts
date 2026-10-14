import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('outbox_messages')
@Index('uq_outbox_tenant_dedupe', ['tenantId', 'dedupeKey'], { unique: true })
export class OutboxMessageOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ type: 'varchar', length: 60 }) declare type: string;
  @Column({ name: 'aggregate_id', type: 'uuid' }) declare aggregateId: string;
  @Column({ type: 'jsonb' }) declare payload: Record<string, unknown>;
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200 })
  declare dedupeKey: string;
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  declare status: string;
  @Column({ name: 'available_at', type: 'timestamptz' })
  declare availableAt: Date;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  declare leaseUntil: Date | null;
  @Column({ type: 'integer', default: 0 }) declare attempts: number;
  @Column({ name: 'last_error', type: 'text', nullable: true })
  declare lastError: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) declare createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) declare updatedAt: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  declare completedAt: Date | null;
}
