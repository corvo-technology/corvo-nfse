import { Index as ManagedIndex } from 'typeorm';
import {
  ForeignKey,
  Index,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_memberships')
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'fk_tenant_memberships_auth_user',
  onDelete: 'CASCADE',
})
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'fk_tenant_memberships_tenant',
  onDelete: 'CASCADE',
})
@Index('idx_tenant_memberships_auth_user_tenant', ['authUserId', 'tenantId'], {
  unique: true,
})
@Index('idx_tenant_memberships_tenant_active', ['tenantId', 'isActive'])
@Index('idx_tenant_memberships_auth_user_active', [
  'authUserId',
  'isActive',
  'createdAt',
])
@ManagedIndex('idx_memberships_cursor', { synchronize: false })
export class TenantMembershipOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'auth_user_id', type: 'uuid' })
  authUserId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50, default: 'admin' })
  role!: string;

  @Column('text', { array: true, default: () => "'{}'" })
  permissions!: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
