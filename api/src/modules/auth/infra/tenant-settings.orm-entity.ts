import {
  ForeignKey,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_settings')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_tenant_settings_tenant',
  onDelete: 'CASCADE',
})
export class TenantSettingsOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50, default: 'UTC' })
  timezone!: string;

  @Column({ name: 'business_hours_start', type: 'integer', default: 9 })
  businessHoursStart!: number;

  @Column({ name: 'business_hours_end', type: 'integer', default: 18 })
  businessHoursEnd!: number;

  @Column({
    name: 'business_days',
    type: 'int',
    array: true,
    default: () => "'{1,2,3,4,5}'",
  })
  businessDays!: number[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
