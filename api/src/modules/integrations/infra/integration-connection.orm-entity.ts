import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('integration_connections')
export class IntegrationConnectionOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId!: string;
  @Column({ name: 'public_id', type: 'varchar', length: 40 }) publicId!: string;
  @Column({ type: 'varchar', length: 40 }) provider!: string;
  @Column({ type: 'varchar', length: 10 }) environment!: 'test' | 'live';
  @Column({
    name: 'external_account_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  externalAccountId!: string | null;
  @Column({ type: 'varchar', length: 20 }) state!: string;
  @Column({ name: 'credentials_enc', type: 'text' }) credentialsEnc!: string;
  @Column({ name: 'active_from', type: 'timestamptz', nullable: true })
  activeFrom!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
