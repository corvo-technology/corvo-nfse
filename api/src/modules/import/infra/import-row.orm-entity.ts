import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('import_rows')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'import_rows_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('ImportOrmEntity', ['importId'], ['id'], {
  name: 'import_rows_import_id_fkey',
  onDelete: 'CASCADE',
})
@Check(
  'ck_import_rows_status',
  `status IN ('valid','invalid','queued','accepted','rejected')`,
)
@Index('idx_import_rows_status', ['importId', 'status', 'line'])
export class ImportRowOrmEntity {
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @PrimaryColumn({ name: 'import_id', type: 'uuid' }) declare importId: string;
  @PrimaryColumn({ type: 'integer' }) declare line: number;
  @Column({ type: 'jsonb' }) declare data: Record<string, unknown>;
  @Column({ type: 'varchar', length: 10 }) declare status: string;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  declare errorCode: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  declare errorMessage: string | null;
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  declare invoiceId: string | null;
}
