import { Unique, Check, ForeignKey } from 'typeorm';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_usage_periods')
@Unique('uq_billing_usage_period', ['tenantId', 'planSlug', 'periodStart'])
@Unique('uq_billing_usage_periods_id_tenant', ['id', 'tenantId'])
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'billing_usage_periods_tenant_id_fkey',
})
@Check('billing_usage_periods_included_check', '"included" >= 0')
@Check('billing_usage_periods_authorized_check', '"authorized" >= 0')
@Check('billing_usage_periods_reserved_check', '"reserved" >= 0')
@Check('billing_usage_periods_check', '"period_end" > "period_start"')
export class BillingUsagePeriod {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'plan_slug', type: 'varchar' }) planSlug!: string;
  @Column({ name: 'period_start', type: 'timestamptz' }) periodStart!: Date;
  @Column({ name: 'period_end', type: 'timestamptz' }) periodEnd!: Date;
  @Column({ type: 'integer' }) included!: number;
  @Column({ type: 'integer', default: 0 }) authorized!: number;
  @Column({ type: 'integer', default: 0 }) reserved!: number;
  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  customerId!: string | null;
  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  subscriptionId!: string | null;
}
