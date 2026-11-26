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

  /**
   * NF-e release for this tenant (null = off). Also needs the global NFE_ENABLED. Set by SQL (and later
   * by the platform admin), never by an insert of a new tenant.
   */
  @Column({
    name: 'nfe_enabled_at',
    type: 'timestamptz',
    nullable: true,
    insert: false,
    update: false,
  })
  nfeEnabledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
