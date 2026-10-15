import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('invoice_fiscal_snapshots')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'invoice_fiscal_snapshots_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Unique('uq_ifs_invoice_attempt', ['invoiceId', 'attempt'])
@Check(
  'ck_ifs_tax_regime',
  `tax_regime IN ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','OUTRO_REGIME','UNKNOWN')`,
)
@Check('ck_ifs_attempt', 'attempt >= 1')
@Index('idx_ifs_tenant', ['tenantId'])
@Index('idx_ifs_company', ['companyId'])
export class InvoiceFiscalSnapshotOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'invoice_id', type: 'uuid' }) declare invoiceId: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ name: 'company_id', type: 'uuid' }) declare companyId: string;
  @Column({ name: 'tax_regime', type: 'varchar', length: 20 })
  declare taxRegime: string;
  @Column({ name: 'profile_id', type: 'uuid' }) declare profileId: string;
  @Column({ name: 'service_profile_id', type: 'uuid', nullable: true })
  declare serviceProfileId: string | null;
  @Column({
    name: 'special_tax_regime',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  declare specialTaxRegime: string | null;
  @Column({ type: 'integer', default: 1 }) declare attempt: number;
  @Column({ name: 'calculation_version', type: 'varchar', length: 40 })
  declare calculationVersion: string;
  @Column({ name: 'gross_amount', type: 'numeric', precision: 15, scale: 2 })
  declare grossAmount: string;
  @Column({ name: 'discount_amount', type: 'numeric', precision: 15, scale: 2 })
  declare discountAmount: string;
  @Column({
    name: 'iss_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  declare issAmount: string | null;
  @Column({
    name: 'cbs_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  declare cbsAmount: string | null;
  @Column({
    name: 'ibs_total_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  declare ibsTotalAmount: string | null;
  @Column({
    name: 'net_receivable_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  declare netReceivableAmount: string;
  @Column({ type: 'jsonb' }) declare result: Record<string, unknown>;
  @Column({ name: 'calculated_at', type: 'timestamptz' })
  declare calculatedAt: Date;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
}
