import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('accountant_package_sends')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'accountant_package_sends_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'accountant_package_sends_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check(
  'ck_accountant_package_sends_month',
  `month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
)
@Check(
  'ck_accountant_package_sends_status',
  `status IN ('sent', 'skipped-empty', 'skipped-too-large', 'failed')`,
)
@Check(
  'ck_accountant_package_sends_trigger',
  `trigger IN ('scheduled', 'manual', 'mcp-or-api')`,
)
@Index('idx_accountant_package_sends_company', ['companyId', 'createdAt'])
@Index('idx_accountant_package_sends_tenant', ['tenantId'])
export class AccountantPackageSendOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId!: string;
  @Column({ type: 'char', length: 7 }) month!: string;
  @Column({ type: 'varchar', length: 254 }) recipient!: string;
  @Column({ name: 'invoice_count', type: 'integer', default: 0 })
  invoiceCount!: number;
  @Column({ name: 'total_cents', type: 'bigint', default: 0 })
  totalCents!: string;
  @Column({ type: 'varchar', length: 20 }) status!: string;
  @Column({ type: 'varchar', length: 20 }) trigger!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
