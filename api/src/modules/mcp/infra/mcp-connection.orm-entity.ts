import { Unique, ForeignKey, Index as ManagedIndex } from 'typeorm';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'mcp_connections' })
@Index('idx_mcp_connections_auth_user_id', ['authUserId'])
@Index('idx_mcp_connections_tenant_id', ['tenantId'])
@ManagedIndex('idx_mcp_connections_cursor', { synchronize: false })
@Unique('mcp_connections_auth_user_tenant_uniq', [
  'authUserId',
  'tenantId',
  'clientId',
])
@ForeignKey('AuthUserOrmEntity', ['authUserId'], ['id'], {
  name: 'mcp_connections_auth_user_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('TenantOrmEntity', ['tenantId'], ['id'], {
  name: 'mcp_connections_tenant_id_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('AuthOAuthClientOrmEntity', ['clientId'], ['id'], {
  name: 'mcp_connections_client_id_fkey',
})
@ForeignKey('AuthSessionOrmEntity', ['sessionId'], ['id'], {
  name: 'mcp_connections_session_id_fkey',
  onDelete: 'CASCADE',
})
export class McpConnectionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'auth_user_id', type: 'uuid' })
  authUserId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'text' })
  clientId!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'text', array: true })
  scopes!: string[];

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'text', default: 'test' })
  environment!: 'test' | 'live';

  @Column({ name: 'tool_calls_count', type: 'integer', default: 0 })
  toolCallsCount!: number;

  @Column({ name: 'invoices_issued_count', type: 'integer', default: 0 })
  invoicesIssuedCount!: number;
}
