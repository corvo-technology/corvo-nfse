import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('portal_sync_cursors')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'portal_sync_cursors_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey(
  'CompanyOrmEntity',
  ['companyId', 'tenantId', 'environment'],
  ['id', 'tenantId', 'environment'],
  { name: 'fk_portal_sync_cursors_company', onDelete: 'CASCADE' },
)
@Check('ck_portal_sync_cursors_environment', `environment IN ('test','live')`)
@Index('uq_portal_sync_cursors_company', ['companyId', 'environment'], {
  unique: true,
})
@Index('idx_portal_sync_cursors_tenant', ['tenantId'])
export class PortalSyncCursorOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ name: 'company_id', type: 'uuid' }) declare companyId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ name: 'last_nsu', type: 'bigint', default: 0 })
  declare lastNsu: string;
  @Column({ name: 'first_round_done_at', type: 'timestamptz', nullable: true })
  declare firstRoundDoneAt: Date | null;
  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  declare lastRunAt: Date | null;
  @Column({ name: 'next_run_at', type: 'timestamptz', default: () => 'now()' })
  declare nextRunAt: Date;
  @Column({ name: 'idle_runs', type: 'integer', default: 0 })
  declare idleRuns: number;
  @Column({ type: 'integer', default: 0 }) declare failures: number;
  @Column({ name: 'last_error', type: 'text', nullable: true })
  declare lastError: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  declare updatedAt: Date;
}
