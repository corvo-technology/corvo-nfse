import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One row per NSU the portal handed out to a company. */
@Entity('portal_documents')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'portal_documents_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey(
  'CompanyOrmEntity',
  ['companyId', 'tenantId', 'environment'],
  ['id', 'tenantId', 'environment'],
  { name: 'fk_portal_documents_company', onDelete: 'CASCADE' },
)
@Check('ck_portal_documents_environment', `environment IN ('test','live')`)
@Index('uq_portal_documents_nsu', ['companyId', 'environment', 'nsu'], {
  unique: true,
})
@Index('idx_portal_documents_access_key', [
  'companyId',
  'environment',
  'accessKey',
])
@Index(
  'idx_portal_documents_unprocessed',
  ['companyId', 'environment', 'nsu'],
  { where: 'processed_at IS NULL' },
)
@Index('idx_portal_documents_tenant', ['tenantId'])
export class PortalDocumentOrmEntity {
  @PrimaryGeneratedColumn('uuid') declare id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) declare tenantId: string;
  @Column({ name: 'company_id', type: 'uuid' }) declare companyId: string;
  @Column({ type: 'varchar', length: 10 }) declare environment: string;
  @Column({ type: 'bigint' }) declare nsu: string;
  @Column({ name: 'access_key', type: 'varchar', length: 60 })
  declare accessKey: string;
  @Column({ name: 'document_type', type: 'varchar', length: 40 })
  declare documentType: string;
  @Column({ name: 'event_type', type: 'varchar', length: 80, nullable: true })
  declare eventType: string | null;
  @Column({ type: 'text' }) declare xml: string;
  @Column({ name: 'generated_at', type: 'timestamptz' })
  declare generatedAt: Date;
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  declare processedAt: Date | null;
  @Column({ type: 'integer', default: 0 }) declare attempts: number;
  @Column({ name: 'last_error', type: 'text', nullable: true })
  declare lastError: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  declare createdAt: Date;
}
