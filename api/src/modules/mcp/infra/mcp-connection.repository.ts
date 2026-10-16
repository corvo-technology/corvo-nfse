import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { McpConnection } from '../domain/mcp-connection';
import type { McpConnectionRepository } from '../domain/mcp-connection.repository';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { McpConnectionOrmEntity } from './mcp-connection.orm-entity';

@Injectable()
export class TypeOrmMcpConnectionRepository implements McpConnectionRepository {
  async listPage(
    userId: string | null,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<McpConnection>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('connection')
        .where('connection.tenant_id = :tenantId', { tenantId });
      if (userId !== null)
        query.andWhere('connection.auth_user_id = :userId', { userId });
      return queryCursorPage(
        query,
        options,
        ['mcp-connections', tenantId, userId ?? 'all'],
        toDomain,
        { column: 'grantedAt' },
      );
    });
  }

  constructor(private readonly db: TypeOrmRepositoryHelper) {}
  private get repo(): Repository<McpConnectionOrmEntity> {
    return this.db.repository(McpConnectionOrmEntity);
  }

  async insert(connection: McpConnection, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, connection.tenantId);
      await this.repo.insert(connection);
    });
  }

  async findById(id: string, tenantId: string): Promise<McpConnection | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({ where: { id, tenantId } });
      return row ? toDomain(row) : null;
    });
  }

  async findAnyByUserTenantClient(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnection | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({
        where: { authUserId: userId, tenantId, clientId },
      });
      return row ? toDomain(row) : null;
    });
  }

  async reconnect(
    id: string,
    tenantId: string,
    next: {
      authUserId: string;
      sessionId: string;
      scopes: string[];
      environment: 'test' | 'live';
    },
  ): Promise<McpConnection> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo.update(
        { id, tenantId, authUserId: next.authUserId },
        {
          sessionId: next.sessionId,
          scopes: next.scopes,
          environment: next.environment,
          revokedAt: null,
          grantedAt: new Date(),
        },
      );
      const row = await this.repo.findOneOrFail({ where: { id, tenantId } });
      return toDomain(row);
    });
  }

  async recordUsage(
    id: string,
    tenantId: string,
    usage: { toolCalls: number; invoicesIssued: number },
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo
        .createQueryBuilder()
        .update()
        .set({
          lastUsedAt: new Date(),
          toolCallsCount: () => `tool_calls_count + ${usage.toolCalls | 0}`,
          invoicesIssuedCount: () =>
            `invoices_issued_count + ${usage.invoicesIssued | 0}`,
        })
        .where('id = :id AND tenant_id = :tenantId', { id, tenantId })
        .execute();
    });
  }

  async findBySession(
    sessionId: string,
    tenantId: string,
    userId: string,
    clientId: string,
  ): Promise<McpConnection | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({
        where: { sessionId, tenantId, authUserId: userId, clientId },
      });
      return row ? toDomain(row) : null;
    });
  }

  async findByIdAndOwner(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<McpConnection | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({
        where: { id, tenantId, authUserId: userId },
      });
      return row ? toDomain(row) : null;
    });
  }

  async findActiveByUserAndTenant(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnection | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({
        where: { authUserId: userId, tenantId, clientId, revokedAt: IsNull() },
      });
      return row ? toDomain(row) : null;
    });
  }

  async findAllByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<McpConnection[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.repo.find({
        where: { authUserId: userId, tenantId },
        order: { grantedAt: 'DESC' },
      });
      return rows.map(toDomain);
    });
  }

  async save(
    connection: McpConnection,
    tenantId: string,
  ): Promise<McpConnection> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await persistTenantEntity(
        this.repo,
        this.repo.create(connection),
        tenantId,
        ['authUserId', 'sessionId', 'clientId'],
      );
      return toDomain(row);
    });
  }

  async revoke(id: string, tenantId: string, userId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo.update(
        { id, tenantId, authUserId: userId },
        { revokedAt: new Date() },
      );
    });
  }

  async touchLastUsed(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo.update(
        { id, tenantId, authUserId: userId },
        { lastUsedAt: new Date() },
      );
    });
  }
}

function toDomain(row: McpConnectionOrmEntity): McpConnection {
  return {
    id: row.id,
    authUserId: row.authUserId,
    tenantId: row.tenantId,
    clientId: row.clientId,
    sessionId: row.sessionId,
    scopes: [...row.scopes],
    environment: row.environment,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    toolCallsCount: row.toolCallsCount,
    invoicesIssuedCount: row.invoicesIssuedCount,
  };
}
