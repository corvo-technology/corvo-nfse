import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('company_nfe_settings')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_company_nfe_settings_tenant',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId', 'tenantId'], ['id', 'tenantId'], {
  name: 'fk_company_nfe_settings_company',
  onDelete: 'CASCADE',
})
@Check('ck_company_nfe_settings_crt', `"crt" IN (1, 4)`)
@Check('ck_company_nfe_settings_series', `"default_series" BETWEEN 0 AND 999`)
@Check(
  'ck_company_nfe_settings_nfce_series',
  `"nfce_default_series" BETWEEN 0 AND 999`,
)
@Check('ck_company_nfe_settings_csosn', `"default_csosn" IN ('102', '400')`)
@Check('ck_company_nfe_settings_origin', `"default_origin" BETWEEN 0 AND 8`)
@Check('ck_company_nfe_settings_contingency', `"contingency_mode" IN ('none')`)
@Index('idx_company_nfe_settings_tenant', ['tenantId'])
export class CompanyNfeSettingsOrmEntity {
  @PrimaryColumn({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'state_registration',
    type: 'varchar',
    length: 14,
    nullable: true,
  })
  stateRegistration!: string | null;

  @Column({ type: 'smallint', nullable: true })
  crt!: number | null;

  @Column({ name: 'default_series', type: 'integer', default: 1 })
  defaultSeries!: number;

  @Column({ name: 'nfce_default_series', type: 'smallint', default: 1 })
  nfceDefaultSeries!: number;

  @Column({ name: 'nfce_auto_offline', type: 'boolean', default: false })
  nfceAutoOffline!: boolean;

  @Column({
    name: 'default_nat_op',
    type: 'varchar',
    length: 60,
    default: 'Venda de mercadoria',
  })
  defaultNatOp!: string;

  @Column({
    name: 'default_csosn',
    type: 'varchar',
    length: 3,
    default: '102',
  })
  defaultCsosn!: string;

  @Column({ name: 'default_origin', type: 'smallint', default: 0 })
  defaultOrigin!: number;

  @Column({
    name: 'default_pis_cst',
    type: 'varchar',
    length: 2,
    default: '49',
  })
  defaultPisCst!: string;

  @Column({
    name: 'default_cofins_cst',
    type: 'varchar',
    length: 2,
    default: '49',
  })
  defaultCofinsCst!: string;

  @Column({ name: 'nfce_csc_id', type: 'varchar', length: 6, nullable: true })
  nfceCscId!: string | null;

  @Column({ name: 'nfce_csc_encrypted', type: 'text', nullable: true })
  nfceCscEncrypted!: string | null;

  @Column({
    name: 'contingency_mode',
    type: 'varchar',
    length: 10,
    default: 'none',
  })
  contingencyMode!: string;

  @Column({ name: 'enabled_at', type: 'timestamptz', nullable: true })
  enabledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
