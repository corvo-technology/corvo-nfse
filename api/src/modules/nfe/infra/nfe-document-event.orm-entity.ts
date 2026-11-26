import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Mirrors `nfe_document_events` (cancellation 110111 and correction letters 110110). */
@Entity('nfe_document_events')
export class NfeDocumentEventOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'tp_evento', type: 'varchar', length: 6 })
  tpEvento!: string;

  @Column({ name: 'n_seq', type: 'smallint' })
  nSeq!: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  protocol!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ name: 'request_xml', type: 'text', nullable: true })
  requestXml!: string | null;

  @Column({ name: 'proc_xml', type: 'text', nullable: true })
  procXml!: string | null;

  @Column({ name: 'xml_path', type: 'text', nullable: true })
  xmlPath!: string | null;

  @Column({ name: 'c_stat', type: 'varchar', length: 10, nullable: true })
  cStat!: string | null;

  @Column({ name: 'x_motivo', type: 'text', nullable: true })
  xMotivo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
