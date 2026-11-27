import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Mirrors `nfe_document_history`: one row per status transition. */
@Entity('nfe_document_history')
export class NfeDocumentHistoryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus!: string;

  @Column({ name: 'access_key', type: 'char', length: 44, nullable: true })
  accessKey!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'c_stat', type: 'varchar', length: 10, nullable: true })
  cStat!: string | null;

  @Column({ name: 'x_motivo', type: 'text', nullable: true })
  xMotivo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
