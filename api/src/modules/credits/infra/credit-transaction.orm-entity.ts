import { Index as ManagedIndex } from 'typeorm';
import { Unique } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('credit_transactions')
@ForeignKey(
  'InvoiceOrmEntity',
  ['reservedInvoiceId', 'tenantId'],
  ['id', 'tenantId'],
  { name: 'fk_credit_invoice_tenant', deferrable: 'INITIALLY DEFERRED' },
)
@ForeignKey(
  'BillingUsagePeriod',
  ['periodId', 'tenantId'],
  ['id', 'tenantId'],
  { name: 'fk_credit_period_tenant' },
)
@ForeignKey(
  'CreditTransactionOrmEntity',
  ['relatedTransactionId', 'tenantId'],
  ['id', 'tenantId'],
  { name: 'fk_credit_related_tenant' },
)
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_credit_transactions_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_credit_transactions_tenant_created_at', ['tenantId', 'createdAt'])
@Index('idx_credit_invoice_debit', ['reservedInvoiceId'], {
  unique: true,
  where: `reserved_invoice_id IS NOT NULL`,
})
@Index('idx_credit_invoice_refund', ['relatedTransactionId'], {
  unique: true,
  where: `type = 'invoice_rejected'`,
})
@Index('idx_credit_transactions_reservation', ['reservedInvoiceId'], {
  where: `"is_reservation" = true`,
})
@Index('uq_credit_payment_ref', ['tenantId', 'stripeSessionId'], {
  unique: true,
  where: `stripe_session_id IS NOT NULL AND type = 'purchase'`,
})
@Unique('uq_credit_transactions_id_tenant', ['id', 'tenantId'])
@ManagedIndex('idx_credit_transactions_cursor', { synchronize: false })
export class CreditTransactionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    name: 'stripe_session_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeSessionId?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'amount_brl_cents', type: 'integer', nullable: true })
  amountBrlCents?: number;

  @Column({ name: 'unit_price_cents_applied', type: 'integer', nullable: true })
  unitPriceCentsApplied?: number;

  @Column({ name: 'plan_id_snapshot', type: 'uuid', nullable: true })
  planIdSnapshot?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  source?: string;

  @Column({ name: 'channel_slug', type: 'varchar', length: 20, nullable: true })
  channelSlug?: string;

  @Column({ name: 'reserved_invoice_id', type: 'uuid', nullable: true })
  reservedInvoiceId?: string;

  @Column({ name: 'period_id', type: 'uuid', nullable: true })
  periodId?: string;

  @Column({ name: 'is_reservation', type: 'boolean', default: false })
  isReservation!: boolean;

  @Column({ name: 'related_transaction_id', type: 'uuid', nullable: true })
  relatedTransactionId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
