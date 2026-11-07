import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('imports')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'imports_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@Check('ck_imports_environment', `environment IN ('test','live')`)
@Check(
  'ck_imports_status',
  `status IN ('processing','ready','emitting','done','failed')`,
)
@Index('idx_imports_tenant', ['tenantId', 'environment', 'createdAt'])
@Index('idx_imports_file_hash', ['tenantId', 'environment', 'fileHash'])
export class ImportOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ name: 'user_id', type: 'varchar', length: 100 })
  declare userId: string;
  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  declare fileName: string;
  @Column({ name: 'file_hash', type: 'varchar', length: 64 })
  declare fileHash: string;
  @Column({ type: 'varchar', length: 12, default: 'processing' })
  declare status: string;
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  declare companyId: string | null;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  declare errorCode: string | null;
  @Column({ name: 'rows_expected', type: 'integer', nullable: true })
  declare rowsExpected: number | null;
  @Column({ name: 'unknown_columns', type: 'jsonb', default: () => "'[]'" })
  declare unknownColumns: string[];
  @Column({ name: 'emit_started_at', type: 'timestamptz', nullable: true })
  declare emitStartedAt: Date | null;
  @Column({ name: 'emit_finished_at', type: 'timestamptz', nullable: true })
  declare emitFinishedAt: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
}
