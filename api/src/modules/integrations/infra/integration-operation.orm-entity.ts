import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('integration_operations')
export class IntegrationOperationOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'connection_id', type: 'uuid' }) connectionId!: string;
  @Column({ type: 'varchar', length: 40 }) provider!: string;
  @Column({ type: 'varchar', length: 10 }) environment!: 'test' | 'live';
  @Column({ name: 'external_account_id', type: 'varchar', length: 200 })
  externalAccountId!: string;
  @Column({ name: 'operation_key', type: 'varchar', length: 300 })
  operationKey!: string;
  @Column({ name: 'commercial_state', type: 'varchar', length: 20 })
  commercialState!: string;
  @Column({ name: 'fiscal_status', type: 'varchar', length: 20 })
  fiscalStatus!: string;
  @Column({ name: 'block_reason', type: 'varchar', length: 60, nullable: true })
  blockReason!: string | null;
  @Column({ type: 'jsonb' }) snapshot!: Record<string, unknown>;
  @Column({ name: 'rule_id', type: 'uuid', nullable: true }) ruleId!:
    | string
    | null;
  @Column({ name: 'emission_request', type: 'jsonb', nullable: true })
  emissionRequest!: Record<string, unknown> | null;
  @Column({
    name: 'emission_request_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  emissionRequestHash!: string | null;
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey!: string | null;
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true }) invoiceId!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
