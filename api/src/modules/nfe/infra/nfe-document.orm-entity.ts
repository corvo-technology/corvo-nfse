import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Mirrors `nfe_documents`; constraints, foreign keys and partial indexes live in the migration. */
@Entity('nfe_documents')
@Index('idx_nfe_documents_company_status', ['companyId', 'status'])
export class NfeDocumentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 10 })
  environment!: string;

  @Column({ type: 'smallint', default: 55 })
  model!: number;

  @Column({ type: 'integer', nullable: true })
  series!: number | null;

  @Column({ type: 'integer', nullable: true })
  number!: number | null;

  @Column({ name: 'access_key', type: 'char', length: 44, nullable: true })
  accessKey!: string | null;

  @Column({ name: 'c_nf', type: 'char', length: 8, nullable: true })
  cNf!: string | null;

  @Column({ name: 'tp_emis', type: 'smallint', default: 1 })
  tpEmis!: number;

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt!: Date | null;

  @Column({ name: 'nat_op', type: 'varchar', length: 60 })
  natOp!: string;

  @Column({ name: 'id_dest', type: 'smallint' })
  idDest!: number;

  @Column({ name: 'ind_final', type: 'smallint', default: 1 })
  indFinal!: number;

  @Column({ name: 'ind_pres', type: 'smallint', default: 1 })
  indPres!: number;

  @Column({ name: 'fin_nfe', type: 'smallint', default: 1 })
  finNfe!: number;

  @Column({ name: 'tp_imp', type: 'smallint', default: 1 })
  tpImp!: number;

  @Column({ type: 'varchar', length: 30, default: 'queued' })
  status!: string;

  @Column({ name: 'c_stat', type: 'varchar', length: 10, nullable: true })
  cStat!: string | null;

  @Column({ name: 'x_motivo', type: 'text', nullable: true })
  xMotivo!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  protocol!: string | null;

  @Column({ name: 'authorized_at', type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  @Column({ type: 'jsonb' })
  recipient!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  totals!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  payment!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'{"modFrete":9}'::jsonb` })
  transport!: Record<string, unknown>;

  @Column({ name: 'additional_info', type: 'text', nullable: true })
  additionalInfo!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'signed_xml', type: 'text', nullable: true })
  signedXml!: string | null;

  @Column({ name: 'prot_nfe_xml', type: 'text', nullable: true })
  protNfeXml!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  authority!: string | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({
    name: 'last_error_type',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  lastErrorType!: string | null;

  @Column({ name: 'next_check_at', type: 'timestamptz', nullable: true })
  nextCheckAt!: Date | null;

  @Column({ name: 'reconcile_attempts', type: 'integer', default: 0 })
  reconcileAttempts!: number;

  @Column({ name: 'send_email', type: 'boolean', default: true })
  sendEmail!: boolean;

  @Column({ name: 'documents_ready_at', type: 'timestamptz', nullable: true })
  documentsReadyAt!: Date | null;

  @Column({ name: 'email_status', type: 'varchar', length: 10, nullable: true })
  emailStatus!: string | null;

  @Column({ name: 'email_sent_at', type: 'timestamptz', nullable: true })
  emailSentAt!: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
