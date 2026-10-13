import { Index as ManagedIndex } from 'typeorm';
import {
  ForeignKey,
  Index,
  Check,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('nfse_certificates')
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'fk_nfse_certificates_company',
  onDelete: 'CASCADE',
})
@Index('idx_nfse_certificates_company_status', ['companyId', 'status'])
@Index('idx_nfse_certificates_company_active', ['companyId'], {
  unique: true,
  where: `"status" = 'active' AND "deleted_at" IS NULL`,
})
@Check(
  'ck_nfse_certificates_status',
  `"status" IN ('active', 'expired', 'revoked')`,
)
@ManagedIndex('idx_certificates_cursor', { synchronize: false })
export class CertificateOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'serial_number', type: 'varchar', length: 100 })
  serialNumber!: string;

  @Column({ name: 'issuer', type: 'varchar', length: 500 })
  issuer!: string;

  @Column({ name: 'subject', type: 'varchar', length: 500 })
  subject!: string;

  @Column({ name: 'fingerprint', type: 'varchar', length: 100 })
  fingerprint!: string;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil!: Date;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'encrypted_blob', type: 'bytea' })
  encryptedBlob!: Buffer;

  @Column({ name: 'encrypted_dek', type: 'bytea' })
  encryptedDek!: Buffer;

  @Column({ name: 'dek_iv', type: 'bytea' })
  dekIv!: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;
}
