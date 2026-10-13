import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import {
  persistTenantEntity,
  assertTenantOwnership,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IApiKeyRepository } from '../domain/api-key.repository';
import { ApiKey } from '../domain/api-key';
import { ApiKeyOrmEntity } from './api-key.orm-entity';

@Injectable()
export class TypeormApiKeyRepository implements IApiKeyRepository {
  async listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<ApiKey>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.repo
          .createQueryBuilder('key')
          .where('key.tenant_id = :tenantId', { tenantId }),
        options,
        ['api-keys', tenantId],
        (entity) => this.toDomain(entity),
      );
    });
  }

  constructor(
    @InjectRepository(ApiKeyOrmEntity)
    private readonly repo: Repository<ApiKeyOrmEntity>,
  ) {}

  private toDomain(entity: ApiKeyOrmEntity): ApiKey {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      name: entity.name,
      environment: entity.environment as ApiKey['environment'],
      keyPrefix: entity.keyPrefix,
      keyHash: entity.keyHash,
      scope: entity.scope as ApiKey['scope'],
      lastUsedAt: entity.lastUsedAt,
      expiresAt: entity.expiresAt,
      createdAt: entity.createdAt,
    };
  }

  private readonly toDomainBound = this.toDomain.bind(this);

  async findByKeyPrefix(prefix: string): Promise<ApiKey | null> {
    return runAsSystem('credential-lookup', async () => {
      const entity = await this.repo.findOne({ where: { keyPrefix: prefix } });
      return entity ? this.toDomainBound(entity) : null;
    });
  }

  async findByTenantId(tenantId: string): Promise<ApiKey[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
      return entities.map(this.toDomainBound);
    });
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<ApiKey | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({ where: { id, tenantId } });
      return entity ? this.toDomainBound(entity) : null;
    });
  }

  async save(apiKey: ApiKey, tenantId: string): Promise<ApiKey> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = this.repo.create({
        id: apiKey.id,
        tenantId: apiKey.tenantId,
        name: apiKey.name,
        environment: apiKey.environment,
        keyPrefix: apiKey.keyPrefix,
        keyHash: apiKey.keyHash,
        scope: apiKey.scope,
        lastUsedAt: apiKey.lastUsedAt,
        expiresAt: apiKey.expiresAt,
      });
      const saved = await persistTenantEntity(this.repo, entity, tenantId, [
        'environment',
        'keyHash',
        'keyPrefix',
      ]);
      return this.toDomainBound(saved);
    });
  }

  async remove(apiKey: ApiKey, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, apiKey.tenantId);
      await this.repo.delete({ id: apiKey.id, tenantId });
    });
  }
}
