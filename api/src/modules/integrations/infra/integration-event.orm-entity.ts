import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('integration_events')
export class IntegrationEventOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'connection_id', type: 'uuid' }) connectionId!: string;
  @Column({ type: 'varchar', length: 40 }) provider!: string;
  @Column({ type: 'varchar', length: 10 }) environment!: 'test' | 'live';
  @Column({ name: 'external_account_id', type: 'varchar', length: 200 })
  externalAccountId!: string;
  @Column({ name: 'delivery_id', type: 'varchar', length: 300 })
  deliveryId!: string;
  @Column({ name: 'external_type', type: 'varchar', length: 100 })
  externalType!: string;
  @Column({ name: 'payload_enc', type: 'text' }) payloadEnc!: string;
  @Column({ type: 'varchar', length: 20 }) state!: string;
  @Column({ type: 'integer' }) attempts!: number;
  @Column({ name: 'claim_token', type: 'uuid', nullable: true }) claimToken!:
    | string
    | null;
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!:
    | string
    | null;
  @Column({ name: 'operation_id', type: 'uuid', nullable: true }) operationId!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
