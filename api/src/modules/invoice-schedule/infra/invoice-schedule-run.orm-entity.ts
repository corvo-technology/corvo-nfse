import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('invoice_schedule_runs')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'invoice_schedule_runs_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('InvoiceScheduleOrmEntity', ['scheduleId'], ['id'], {
  name: 'invoice_schedule_runs_schedule_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_invoice_schedule_runs_outcome', `outcome IN ('issued','failed')`)
@Index(
  'uq_invoice_schedule_runs_attempt',
  ['scheduleId', 'occurrenceOn', 'attempt'],
  { unique: true },
)
@Index('idx_invoice_schedule_runs_schedule', ['scheduleId', 'createdAt'])
export class InvoiceScheduleRunOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ name: 'schedule_id', type: 'uuid' }) declare scheduleId: string;
  @Column({ name: 'occurrence_on', type: 'date' }) declare occurrenceOn: string;
  @Column({ name: 'ran_on', type: 'date' }) declare ranOn: string;
  @Column({ type: 'integer' }) declare attempt: number;
  @Column({ type: 'varchar', length: 10 }) declare outcome: string;
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  declare invoiceId: string | null;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  declare errorCode: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  declare errorMessage: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
}
