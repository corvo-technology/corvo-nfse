import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('invoice_fiscal_reconciliations')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'invoice_fiscal_reconciliations_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Unique('uq_ifr_invoice_id', ['invoiceId'])
@Check('ck_ifr_status', `status IN ('matched','within_tolerance','divergent')`)
@Index('idx_ifr_tenant_id', ['tenantId'])
export class InvoiceFiscalReconciliationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'local_values', type: 'jsonb' })
  localValues!: Record<string, string | null>;

  @Column({ name: 'authorized_values', type: 'jsonb' })
  authorizedValues!: Record<string, string | null>;

  @Column({ type: 'jsonb' })
  differences!: unknown[];

  @Column({ name: 'tolerance_absolute', type: 'varchar', length: 12 })
  toleranceAbsolute!: string;

  @Column({ name: 'rules_version', type: 'varchar', length: 20 })
  rulesVersion!: string;

  @Column({ name: 'reconciled_at', type: 'timestamptz' })
  reconciledAt!: Date;
}
