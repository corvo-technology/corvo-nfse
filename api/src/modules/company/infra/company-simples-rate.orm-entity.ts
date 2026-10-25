import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
} from 'typeorm';

const numericString = {
  to: (value: string | null | undefined): string | null | undefined => value,
  from: (
    value: string | number | null | undefined,
  ): string | null | undefined =>
    value === null || value === undefined ? value : String(value),
};

@Entity('company_simples_rates')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'company_simples_rates_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'company_simples_rates_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_csr_month', `month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
@Check('ck_csr_total_rate', `total_rate BETWEEN 0 AND 100`)
@Check('ck_csr_iss_rate', `iss_rate IS NULL OR iss_rate BETWEEN 0 AND 100`)
@Check('ck_csr_ibs_rate', `ibs_rate IS NULL OR ibs_rate BETWEEN 0 AND 100`)
@Check('ck_csr_cbs_rate', `cbs_rate IS NULL OR cbs_rate BETWEEN 0 AND 100`)
@Index('idx_csr_tenant', ['tenantId'])
export class CompanySimplesRateOrmEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @PrimaryColumn({ name: 'month', type: 'char', length: 7 })
  month!: string;

  @Column({
    name: 'total_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: numericString,
  })
  totalRate!: string;

  @Column({
    name: 'iss_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericString,
  })
  issRate?: string | null;

  @Column({
    name: 'ibs_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericString,
  })
  ibsRate?: string | null;

  @Column({
    name: 'cbs_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericString,
  })
  cbsRate?: string | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
