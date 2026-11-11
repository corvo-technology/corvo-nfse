import { Index as ManagedIndex } from 'typeorm';
import type { MunicipalityAgreementAnswer } from '../domain/municipality-agreement';
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

@Entity('nfse_companies')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_nfse_companies_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_company_execution_identity', ['id', 'tenantId', 'environment'], {
  unique: true,
})
@Index('idx_nfse_companies_tenant', ['tenantId'])
@Index(
  'idx_nfse_companies_tenant_tax_id',
  ['tenantId', 'environment', 'taxId'],
  {
    unique: true,
    where: `"deleted_at" IS NULL`,
  },
)
@Check(
  'ck_nfse_companies_status',
  `"status" IN ('pending_setup', 'ready', 'blocked')`,
)
@Check('ck_nfse_companies_environment', `"environment" IN ('test', 'live')`)
@ManagedIndex('idx_companies_cursor', { synchronize: false })
export class CompanyOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName!: string;

  @Column({ name: 'trade_name', type: 'varchar', length: 200, nullable: true })
  tradeName?: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 20 })
  taxId!: string;

  @Column({
    name: 'municipal_reg',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  municipalReg?: string | null;

  @Column({ name: 'send_municipal_reg', type: 'boolean', default: false })
  sendMunicipalReg!: boolean;

  @Column({
    name: 'municipality_code',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  municipalityCode?: string;

  @Column({
    name: 'default_service_code',
    type: 'varchar',
    length: 6,
    nullable: true,
  })
  defaultServiceCode?: string | null;

  @Column({
    name: 'address_street',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  addressStreet?: string;

  @Column({
    name: 'address_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  addressNumber?: string;

  @Column({
    name: 'address_complement',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  addressComplement?: string;

  @Column({
    name: 'address_district',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  addressDistrict?: string;

  @Column({
    name: 'address_city',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  addressCity?: string;

  @Column({ name: 'address_state', type: 'char', length: 2, nullable: true })
  addressState?: string;

  @Column({ name: 'address_zip', type: 'varchar', length: 10, nullable: true })
  addressZip?: string;

  @Column({
    name: 'simples_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  simplesRate?: string | null;

  @Column({
    name: 'simples_iss_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  simplesIssRate?: string | null;

  @Column({
    name: 'fiscal_schema_version',
    type: 'varchar',
    length: 20,
    default: 'v2_02',
  })
  fiscalSchemaVersion!: string;

  @Column({
    name: 'environment',
    type: 'varchar',
    length: 10,
    default: 'test',
  })
  environment!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: 'pending_setup',
  })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  /** Last `consultarConvenio` answer; written only by the agreement store, never by the company mapper. */
  @Column({ name: 'municipality_agreement', type: 'jsonb', nullable: true })
  municipalityAgreement?: MunicipalityAgreementAnswer | null;

  @Column({
    name: 'municipality_agreement_checked_at',
    type: 'timestamptz',
    nullable: true,
  })
  municipalityAgreementCheckedAt?: Date | null;
}
