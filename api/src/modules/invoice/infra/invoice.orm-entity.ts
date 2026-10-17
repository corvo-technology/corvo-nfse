import { Index as ManagedIndex } from 'typeorm';
import { Unique } from 'typeorm';
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

@Entity('nfse_invoices')
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'fk_nfse_invoices_company',
  onDelete: 'CASCADE',
})
@ForeignKey(
  'CompanyOrmEntity',
  ['companyId', 'tenantId', 'environment'],
  ['id', 'tenantId', 'environment'],
  { name: 'fk_invoice_execution_company' },
)
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_nfse_invoices_tenant',
  onDelete: 'CASCADE',
})
@Index(
  'idx_nfse_invoices_idempotency',
  ['tenantId', 'environment', 'idempotencyKey'],
  { unique: true },
)
@Check('ck_nfse_invoices_environment', `"environment" IN ('test','live')`)
@Check(
  'ck_nfse_invoices_last_email_status',
  `"last_email_status" IN ('queued','sent','failed')`,
)
@Index('idx_nfse_invoices_company_status', ['companyId', 'status'])
@Index('idx_nfse_invoices_environment_created', [
  'tenantId',
  'environment',
  'createdAt',
])
@Index('idx_invoices_docs_pending', ['authorizedAt'], {
  where: `status = 'authorized' AND documents_ready_at IS NULL`,
})
@Index('idx_nfse_invoices_tenant_created_at', ['tenantId', 'createdAt'])
@Check(
  'ck_nfse_invoices_status',
  `"status" IN ('queued', 'processing', 'authorized', 'rejected', 'retry_pending', 'reconciliation_required', 'manual_review', 'failed', 'cancelling', 'cancelled')`,
)
@Unique('uq_nfse_invoices_id_tenant', ['id', 'tenantId'])
@ManagedIndex('idx_invoices_cursor', { synchronize: false })
export class InvoiceOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 10, default: 'test' })
  environment!: string;

  @Column({ name: 'document_key_version', type: 'integer', default: 2 })
  documentKeyVersion!: number;

  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true })
  requestHash?: string;

  @Column({
    name: 'pending_emission',
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  pendingEmission?: Record<string, unknown> | null;

  @Column({ name: 'email_snapshot', type: 'jsonb', nullable: true })
  emailSnapshot?: { send?: boolean };

  @Column({ name: 'external_id', type: 'varchar', length: 100, nullable: true })
  externalId?: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  idempotencyKey?: string;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot!: Record<string, unknown>;

  @Column({ name: 'service_snapshot', type: 'jsonb' })
  serviceSnapshot!: Record<string, unknown>;

  @Column({ name: 'tax_snapshot', type: 'jsonb' })
  taxSnapshot!: Record<string, unknown>;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: number;

  @Column({ type: 'char', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'competence_date', type: 'date' })
  competenceDate!: string;

  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor?: Date | null;

  @Column({ name: 'dps_id', type: 'varchar', length: 50, nullable: true })
  dpsId?: string;

  @Column({ name: 'dps_series', type: 'varchar', length: 10, nullable: true })
  dpsSeries?: string;

  @Column({ name: 'dps_number', type: 'bigint', nullable: true })
  dpsNumber?: number;

  @Column({ name: 'access_key', type: 'varchar', length: 60, nullable: true })
  accessKey?: string;

  @Column({ name: 'nfse_number', type: 'bigint', nullable: true })
  nfseNumber?: number;

  @Column({
    name: 'fiscal_provider',
    type: 'varchar',
    length: 30,
    default: 'national',
  })
  fiscalProvider!: string;

  @Column({
    name: 'fiscal_schema_version',
    type: 'varchar',
    length: 20,
    default: 'v2_02',
  })
  fiscalSchemaVersion!: string;

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt?: Date;

  @Column({ name: 'authorized_at', type: 'timestamptz', nullable: true })
  authorizedAt?: Date;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  lastErrorCode?: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage?: string | null;

  @Column({ name: 'last_error_provider', type: 'text', nullable: true })
  lastErrorProvider?: string | null;

  @Column({
    name: 'documents_ready_at',
    type: 'timestamptz',
    nullable: true,
  })
  documentsReadyAt?: Date;

  @Column({
    name: 'last_email_status',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  lastEmailStatus?: string;

  @Column({
    name: 'last_email_sent_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastEmailSentAt?: Date;

  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  cancellationReason?: string | null;

  @Column({ name: 'cancellation_description', type: 'text', nullable: true })
  cancellationDescription?: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
