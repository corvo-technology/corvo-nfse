import {
  ForeignKey,
  Index,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'tenant_billing' })
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_tenant_billing_tenant',
  onDelete: 'CASCADE',
})
@ForeignKey('PlanOrmEntity', ['downgradeToPlanId'], ['id'], {
  name: 'fk_tenant_billing_downgrade',
  onDelete: 'RESTRICT',
})
@Index('idx_tenant_billing_email', ['billingEmail'])
@Index('idx_tenant_billing_tax_id', ['billingTaxId'])
export class TenantBillingOrmEntity {
  @Column({ name: 'checkout_state', type: 'jsonb', nullable: true })
  checkoutState!: {
    id: string;
    requestKey: string;
    planSlug: string;
    sessionId: string | null;
    url: string | null;
    expiresAt: string | null;
    createdAt: string;
  } | null;

  @Column({
    name: 'stripe_customer_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  stripeCustomerId!: string | null;

  @Column({
    name: 'stripe_subscription_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  stripeSubscriptionId!: string | null;

  @Column({ name: 'stripe_status', type: 'varchar', nullable: true })
  stripeStatus!: string | null;

  @Column({ name: 'paid_until', type: 'timestamptz', nullable: true })
  paidUntil!: Date | null;

  @Column({ name: 'pending_plan_slug', type: 'varchar', nullable: true })
  pendingPlanSlug!: string | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId!: string;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ name: 'downgrade_to_plan_id', type: 'uuid', nullable: true })
  downgradeToPlanId!: string | null;

  @Column({
    name: 'billing_email',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  billingEmail!: string | null;

  @Column({
    name: 'billing_tax_id',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  billingTaxId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
