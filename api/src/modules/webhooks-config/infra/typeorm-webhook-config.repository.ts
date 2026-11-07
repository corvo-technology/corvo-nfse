import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import {
  persistTenantEntity,
  assertTenantOwnership,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, IsNull, Repository } from 'typeorm';
import { WebhookConfig } from '../domain/webhook-config';
import { IWebhookConfigRepository } from '../domain/webhook-config.repository';
import { WebhookConfigEntity } from './webhook-config.orm-entity';

@Injectable()
export class TypeOrmWebhookConfigRepository implements IWebhookConfigRepository {
  async listPage(
    tenantId: string,
    options: CursorQuery,
    keyEnvironment?: 'test' | 'live',
  ): Promise<CursorPage<WebhookConfig>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('webhook')
        .where('webhook.tenant_id = :tenantId', { tenantId });
      // Endpoints for both environments count as live (see webhookVisibleTo).
      if (keyEnvironment)
        query.andWhere(
          "COALESCE(webhook.environment, 'live') = :keyEnvironment",
          { keyEnvironment },
        );
      return queryCursorPage(
        query,
        options,
        ['webhooks', tenantId, keyEnvironment ?? 'all'],
        (entity) => entity,
      );
    });
  }

  constructor(
    @InjectRepository(WebhookConfigEntity)
    private readonly repo: Repository<WebhookConfigEntity>,
  ) {}

  async findByTenantId(tenantId: string): Promise<WebhookConfig[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
    });
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<WebhookConfig | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.findOne({ where: { id, tenantId } });
    });
  }

  async findByTenantIdAndEvent(
    tenantId: string,
    event: string,
    environment: 'test' | 'live',
  ): Promise<WebhookConfig[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const base = { tenantId, active: true, events: ArrayContains([event]) };
      return this.repo.find({
        where: [
          { ...base, environment: IsNull() },
          { ...base, environment },
        ],
      });
    });
  }

  async save(webhook: WebhookConfig, tenantId: string): Promise<WebhookConfig> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return persistTenantEntity(
        this.repo,
        this.repo.create(webhook),
        tenantId,
      );
    });
  }

  async remove(webhook: WebhookConfig, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, webhook.tenantId);
      await this.repo.delete({ id: webhook.id, tenantId });
    });
  }
}
