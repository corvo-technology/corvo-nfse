import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { toDateString } from './company-fiscal-profile.orm-entity';

const dateTransformer = {
  to: (value: string | null): string | null => value,
  from: (value: Date | string | null | undefined): string | null | undefined =>
    value === null || value === undefined ? value : toDateString(value),
};

const numericStringTransformer = {
  to: (value: string | null): string | null => value,
  from: (value: string | number | null | undefined): string | null | undefined =>
    value === null || value === undefined ? value : String(value),
};

const jsonTransformer = {
  to: (value: Record<string, string>): string => JSON.stringify(value ?? {}),
  from: (value: string | Record<string, string> | null | undefined):
    | Record<string, string>
    | null
    | undefined => {
    if (value === null || value === undefined) return value;
    return typeof value === 'string'
      ? (JSON.parse(value) as Record<string, string>)
      : value;
  },
};

@Entity('company_service_tax_profiles')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'company_service_tax_profiles_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'company_service_tax_profiles_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check(
  'ck_cstp_service_code',
  `service_code ~ '^[0-9]{6}$'`,
)
@Check(
  'ck_cstp_operation_nature',
  `operation_nature IN ('SERVICE','GOODS','MIXED','PARTNER_SALON')`,
)
@Check(
  'ck_cstp_iss_taxation',
  `iss_taxation IS NULL OR iss_taxation IN ('NORMAL','FIXED','EXEMPT')`,
)
@Check(
  'ck_cstp_withholding_policy',
  `withholding_policy IN ('UNKNOWN','NONE_CONFIRMED','CONFIGURED')`,
)
@Check('ck_cstp_iss_rate', `iss_rate IS NULL OR iss_rate BETWEEN 0 AND 100`)
@Check(
  'ck_cstp_validity',
  `effective_until IS NULL OR effective_until > effective_from`,
)
@Check(
  'ck_cstp_review',
  `review_status IN ('unreviewed','approved','rejected')`,
)
@Index('idx_cstp_company_service', [
  'companyId',
  'serviceCode',
  'effectiveFrom',
])
@Index('idx_cstp_tenant', ['tenantId'])
export class CompanyServiceTaxProfileOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'service_code', type: 'varchar', length: 6 })
  serviceCode!: string;

  @Column({ name: 'municipal_service_code', type: 'varchar', length: 20, nullable: true })
  municipalServiceCode!: string | null;

  @Column({ name: 'nbs_code', type: 'varchar', length: 9, nullable: true })
  nbsCode!: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  cst!: string | null;

  @Column({ name: 'class_code', type: 'varchar', length: 6, nullable: true })
  classCode!: string | null;

  @Column({ name: 'operation_indicator', type: 'varchar', length: 6, nullable: true })
  operationIndicator!: string | null;

  @Column({
    name: 'operation_nature',
    type: 'varchar',
    length: 15,
    default: 'SERVICE',
  })
  operationNature!: string;

  @Column({
    name: 'regime_applicability',
    type: 'text',
    array: true,
    default: '{}',
  })
  regimeApplicability!: string[];

  @Column({
    name: 'incidence_municipality_code',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  incidenceMunicipalityCode!: string | null;

  @Column({ name: 'iss_taxation', type: 'varchar', length: 10, nullable: true })
  issTaxation!: string | null;

  @Column({
    name: 'iss_rate',
    type: 'numeric',
    precision: 8,
    scale: 5,
    nullable: true,
    transformer: numericStringTransformer,
  })
  issRate!: string | null;

  @Column({ name: 'iss_withholding_default', type: 'boolean', default: false })
  issWithholdingDefault!: boolean;

  @Column({
    name: 'withholding_policy',
    type: 'varchar',
    length: 15,
    default: 'UNKNOWN',
  })
  withholdingPolicy!: string;

  @Column({
    name: 'withholding_rates',
    type: 'jsonb',
    default: '{}',
    transformer: jsonTransformer,
  })
  withholdingRates!: Record<string, string>;

  @Column({
    name: 'effective_from',
    type: 'date',
    transformer: dateTransformer,
  })
  effectiveFrom!: string;

  @Column({
    name: 'effective_until',
    type: 'date',
    nullable: true,
    transformer: dateTransformer,
  })
  effectiveUntil!: string | null;

  @Column({ name: 'classification_source', type: 'varchar', length: 30 })
  classificationSource!: string;

  @Column({
    name: 'review_status',
    type: 'varchar',
    length: 12,
    default: 'unreviewed',
  })
  reviewStatus!: string;

  @Column({ name: 'catalog_version', type: 'varchar', length: 40, nullable: true })
  catalogVersion!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
