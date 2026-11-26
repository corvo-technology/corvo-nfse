import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Mirrors `nfe_inutilizations`: a request to void a range of unused numbers. */
@Entity('nfe_inutilizations')
export class NfeInutilizationOrmEntity {
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

  @Column({ type: 'integer' })
  series!: number;

  @Column({ name: 'start_number', type: 'integer' })
  startNumber!: number;

  @Column({ name: 'end_number', type: 'integer' })
  endNumber!: number;

  @Column({ type: 'text' })
  justification!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  protocol!: string | null;

  @Column({ name: 'c_stat', type: 'varchar', length: 10, nullable: true })
  cStat!: string | null;

  @Column({ name: 'x_motivo', type: 'text', nullable: true })
  xMotivo!: string | null;

  @Column({ name: 'request_xml', type: 'text', nullable: true })
  requestXml!: string | null;

  @Column({ name: 'proc_xml', type: 'text', nullable: true })
  procXml!: string | null;

  @Column({ name: 'xml_path', type: 'text', nullable: true })
  xmlPath!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({ name: 'request_hash', type: 'char', length: 64, nullable: true })
  requestHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
