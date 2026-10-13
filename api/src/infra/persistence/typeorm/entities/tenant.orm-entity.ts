import {
  ForeignKey,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'tenants' })
@ForeignKey('PlanOrmEntity', ['planId'], ['id'], {
  name: 'fk_tenants_plan',
  onDelete: 'RESTRICT',
})
export class TenantOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
