import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('product_favorites')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'product_favorites_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'product_favorites_company_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_product_favorites_ncm', `ncm ~ '^[0-9]{8}$'`)
@Check('ck_product_favorites_price', `unit_price >= 0`)
@Index('idx_product_favorites_company', ['companyId', 'createdAt'])
@Index('idx_product_favorites_tenant', ['tenantId'])
export class ProductFavoriteOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId!: string;
  @Column({ type: 'varchar', length: 120 }) description!: string;
  @Column({ type: 'varchar', length: 60, default: '' }) code!: string;
  @Column({ type: 'varchar', length: 14, nullable: true }) gtin!: string | null;
  @Column({ type: 'varchar', length: 8 }) ncm!: string;
  @Column({ type: 'varchar', length: 7, nullable: true }) cest!: string | null;
  @Column({ type: 'varchar', length: 4, nullable: true }) cfop!: string | null;
  @Column({ type: 'varchar', length: 6, default: 'UN' }) unit!: string;
  @Column({ name: 'unit_price', type: 'numeric', precision: 15, scale: 4 })
  unitPrice!: string;
  @Column({ type: 'varchar', length: 3, nullable: true }) csosn!: string | null;
  @Column({ type: 'smallint', nullable: true }) origin!: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
