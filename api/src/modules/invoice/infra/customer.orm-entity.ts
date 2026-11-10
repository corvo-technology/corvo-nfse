import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('customers')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'customers_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_customers_environment', `environment IN ('test','live')`)
@Index('uq_customers_tax_id', ['tenantId', 'environment', 'taxId'], {
  unique: true,
})
@Index('idx_customers_recent', ['tenantId', 'environment', 'lastUsedAt'])
export class CustomerOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ name: 'tax_id', type: 'varchar', length: 14 })
  declare taxId: string;
  @Column({ type: 'varchar', length: 300 }) declare name: string;
  @Column({ type: 'varchar', length: 255, nullable: true })
  declare email: string | null;
  @Column({ name: 'last_used_at', type: 'timestamptz', default: () => 'now()' })
  declare lastUsedAt: Date;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  declare updatedAt: Date;
}
