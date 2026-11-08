import { Index as ManagedIndex } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('api_keys')
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_api_keys_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_api_keys_tenant', ['tenantId'])
@ManagedIndex('idx_api_keys_cursor', { synchronize: false })
export class ApiKeyOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 10, default: 'live' })
  environment!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 64, unique: true })
  keyPrefix!: string;

  @Column({ name: 'key_hash', type: 'varchar', length: 255 })
  keyHash!: string;

  @Column({ type: 'varchar', length: 50 })
  scope!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
