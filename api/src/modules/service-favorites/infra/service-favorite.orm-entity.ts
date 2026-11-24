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
  @Column({ name: 'service_code', type: 'varchar', length: 6 })
  serviceCode!: string;
  @Column({ name: 'amount_cents', type: 'integer', nullable: true })
  amountCents!: number | null;
  @Column({
    name: 'municipality_code',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  municipalityCode!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
