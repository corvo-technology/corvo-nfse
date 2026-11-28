import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('service_favorites')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'service_favorites_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'service_favorites_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_service_favorites_service_code', `service_code ~ '^[0-9]{6}$'`)
@Check(
  'ck_service_favorites_amount',
  `amount_cents IS NULL OR amount_cents > 0`,
)
@Index('idx_service_favorites_company', ['companyId', 'createdAt'])
@Index('idx_service_favorites_tenant', ['tenantId'])
export class ServiceFavoriteOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId!: string;
  @Column({ type: 'varchar', length: 80 }) label!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ type: 'varchar', length: 10, default: 'service' }) kind!: string;
  @Column({ name: 'service_code', type: 'varchar', length: 6, nullable: true })
  serviceCode!: string | null;
  @Column({ name: 'amount_cents', type: 'integer', nullable: true })
  amountCents!: number | null;
  @Column({
    name: 'municipality_code',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  municipalityCode!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) code!: string | null;
  @Column({ type: 'varchar', length: 14, nullable: true }) gtin!: string | null;
  @Column({ type: 'varchar', length: 8, nullable: true }) ncm!: string | null;
  @Column({ type: 'varchar', length: 7, nullable: true }) cest!: string | null;
  @Column({ type: 'varchar', length: 4, nullable: true }) cfop!: string | null;
  @Column({ type: 'varchar', length: 6, nullable: true }) unit!: string | null;
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  unitPrice!: string | null;
  @Column({ type: 'varchar', length: 3, nullable: true }) csosn!: string | null;
  @Column({ type: 'smallint', nullable: true }) origin!: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
