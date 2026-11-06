import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('invoice_schedules')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'invoice_schedules_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_invoice_schedules_environment', `environment IN ('test','live')`)
@Check('ck_invoice_schedules_kind', `kind IN ('once','recurring')`)
@Check(
  'ck_invoice_schedules_frequency',
  `frequency IS NULL OR frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')`,
)
@Check(
  'ck_invoice_schedules_status',
  `status IN ('active','paused','completed','cancelled')`,
)
@Check(
  'ck_invoice_schedules_pause_reason',
  `pause_reason IS NULL OR pause_reason IN ('customer','failures')`,
)
@Index('idx_invoice_schedules_due', ['nextRunOn'], {
  where: "status = 'active'",
})
@Index('idx_invoice_schedules_tenant', ['tenantId', 'createdAt'])
export class InvoiceScheduleOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ name: 'company_id', type: 'uuid' }) declare companyId: string;
  @Column({ type: 'varchar', length: 10 }) declare kind: string;
  @Column({ type: 'varchar', length: 10, nullable: true })
  declare frequency: string | null;
  @Column({ name: 'anchor_on', type: 'date' }) declare anchorOn: string;
  @Column({ name: 'ends_on', type: 'date', nullable: true })
  declare endsOn: string | null;
  @Column({ name: 'invoice_input', type: 'jsonb' })
  declare invoiceInput: Record<string, unknown>;
  @Column({ type: 'varchar', length: 10, default: 'active' })
  declare status: string;
  @Column({
    name: 'pause_reason',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  declare pauseReason: string | null;
  @Column({ name: 'occurrence_index', type: 'integer', default: 0 })
  declare occurrenceIndex: number;
  @Column({ name: 'next_run_on', type: 'date', nullable: true })
  declare nextRunOn: string | null;
  @Column({ type: 'integer', default: 0 }) declare attempts: number;
  @Column({ name: 'last_run_on', type: 'date', nullable: true })
  declare lastRunOn: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true })
  declare createdBy: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  declare updatedAt: Date;
}
