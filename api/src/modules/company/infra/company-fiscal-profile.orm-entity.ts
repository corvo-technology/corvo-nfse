import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Normalizes a PostgreSQL `date` value to `YYYY-MM-DD`. node-postgres parses
 * `date` into a Date at local midnight (America/Sao_Paulo), so local date
 * components are the stored date; ISO slices would drift across timezones.
 */
export function toDateString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}

const dateTransformer = {
  to: (value: string | null): string | null => value,
  from: (value: Date | string | null | undefined): string | null | undefined =>
    value === null || value === undefined ? value : toDateString(value),
};

const numericStringTransformer = {
  to: (value: string | null): string | null => value,
  from: (
    value: string | number | null | undefined,
  ): string | null | undefined =>
    value === null || value === undefined ? value : String(value),
};

@Entity('company_fiscal_profiles')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'company_fiscal_profiles_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'company_fiscal_profiles_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check(
  'ck_cfp_regime',
  `tax_regime IN ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','OUTRO_REGIME','UNKNOWN')`,
)
@Check(
  'ck_cfp_simples_apuracao',
  `simples_apuracao IS NULL OR simples_apuracao IN ('SN','ISS_MUNICIPAL','REGULAR')`,
)
@Check('ck_cfp_review', `review_status IN ('unreviewed','approved','rejected')`)
@Check('ck_cfp_validity', `valid_until IS NULL OR valid_until > valid_from`)
@Check(
  'ck_cfp_simples_iss_rate',
  `simples_iss_rate IS NULL OR simples_iss_rate BETWEEN 1.80 AND 5.00`,
)
@Index('uq_cfp_company_valid_from', ['companyId', 'validFrom'], {
  unique: true,
})
@Index('uq_cfp_company_open', ['companyId'], {
  unique: true,
  where: '"valid_until" IS NULL',
})
@Index('idx_cfp_company_validity', ['companyId', 'validFrom', 'validUntil'])
@Index('idx_cfp_tenant', ['tenantId'])
export class CompanyFiscalProfileOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'tax_regime', type: 'varchar', length: 20 })
  taxRegime!: string;

  @Column({ name: 'simple_national', type: 'boolean', default: false })
  simpleNational!: boolean;

  @Column({
    name: 'special_tax_regime',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  specialTaxRegime?: string | null;

  @Column({ name: 'ibs_cbs_regular_option', type: 'boolean', default: false })
  ibsCbsRegularOption!: boolean;

  @Column({
    name: 'ibs_cbs_regular_from',
    type: 'date',
    nullable: true,
    transformer: dateTransformer,
  })
  ibsCbsRegularFrom?: string | null;

  @Column({
    name: 'simples_iss_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericStringTransformer,
  })
  simplesIssRate?: string | null;

  @Column({
    name: 'simples_apuracao',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  simplesApuracao?: string | null;

  @Column({ name: 'valid_from', type: 'date', transformer: dateTransformer })
  validFrom!: string;

  @Column({
    name: 'valid_until',
    type: 'date',
    nullable: true,
    transformer: dateTransformer,
  })
  validUntil?: string | null;

  @Column({ name: 'source', type: 'varchar', length: 30 })
  source!: string;

  @Column({
    name: 'review_status',
    type: 'varchar',
    length: 12,
    default: 'unreviewed',
  })
  reviewStatus!: string;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 100, nullable: true })
  reviewedBy?: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
