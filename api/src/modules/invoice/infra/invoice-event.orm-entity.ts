import { Index as ManagedIndex } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('nfse_invoice_events')
@ForeignKey('InvoiceOrmEntity', ['invoiceId'], ['id'], {
  name: 'fk_nfse_invoice_events_invoice',
  onDelete: 'CASCADE',
})
@Index('idx_nfse_invoice_events_invoice_created_at', ['invoiceId', 'createdAt'])
@ManagedIndex('idx_invoice_events_cursor', { synchronize: false })
export class InvoiceEventOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus?: string;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
