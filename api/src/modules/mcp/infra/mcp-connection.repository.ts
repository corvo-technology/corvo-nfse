import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { McpConnectionOrmEntity } from './mcp-connection.orm-entity';

export interface McpConnectionRepository {
  listPage(
    userId: string,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<McpConnectionOrmEntity>>;
  findByIdAndOwner(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<McpConnectionOrmEntity | null>;
  findActiveByUserAndTenant(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnectionOrmEntity | null>;
  findAllByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<McpConnectionOrmEntity[]>;
  save(
    connection: McpConnectionOrmEntity,
    tenantId: string,
  ): Promise<McpConnectionOrmEntity>;
  revoke(id: string, tenantId: string, userId: string): Promise<void>;
  touchLastUsed(id: string, tenantId: string, userId: string): Promise<void>;
}

@Injectable()
export class TypeOrmMcpConnectionRepository implements McpConnectionRepository {
  async listPage(
    userId: string,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<McpConnectionOrmEntity>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.repo
          .createQueryBuilder('connection')
          .where(
            'connection.auth_user_id = :userId AND connection.tenant_id = :tenantId',
            { userId, tenantId },
          ),
        options,
        ['mcp-connections', tenantId, userId],
        (entity) => entity,
        { column: 'grantedAt' },
      );
    });
  }

  constructor(
    @InjectRepository(McpConnectionOrmEntity)
    private readonly repo: Repository<McpConnectionOrmEntity>,
  ) {}

  async findByIdAndOwner(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<McpConnectionOrmEntity | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.findOne({ where: { id, tenantId, authUserId: userId } });
    });
  }

  async findActiveByUserAndTenant(
    userId: string,
    tenantId: string,
    clientId: string,
  ): Promise<McpConnectionOrmEntity | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.findOne({
        where: { authUserId: userId, tenantId, clientId, revokedAt: IsNull() },
      });
    });
  }

  async findAllByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<McpConnectionOrmEntity[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.find({
        where: { authUserId: userId, tenantId },
        order: { grantedAt: 'DESC' },
      });
    });
  }

  async save(
    connection: McpConnectionOrmEntity,
    tenantId: string,
  ): Promise<McpConnectionOrmEntity> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return persistTenantEntity(
        this.repo,
        this.repo.create(connection),
        tenantId,
        ['authUserId', 'sessionId', 'clientId'],
      );
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
