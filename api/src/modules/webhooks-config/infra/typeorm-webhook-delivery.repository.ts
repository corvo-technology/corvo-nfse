import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import {
  queryCursorPage,
  readKeysetCursor,
} from '@/shared/http/keyset-pagination';
import { invalidCursor } from '@/shared/http/pagination';
import { WebhookDeliveryQuery } from '@/shared/http/webhook-delivery-query';
/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThanOrEqual, In } from 'typeorm';
import { IWebhookDeliveryRepository } from '../domain/webhook-delivery.repository';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../domain/webhook-delivery';
import { WebhookDeliveryOrmEntity } from './webhook-delivery.orm-entity';

@Injectable()
export class TypeormWebhookDeliveryRepository implements IWebhookDeliveryRepository {
  async listPage(tenantId: string, options: WebhookDeliveryQuery) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const scope = [
        'webhook-deliveries',
        tenantId,
        options.environment ?? null,
        options.hours ?? 24,
      ];
      const cursor = readKeysetCursor(options.cursor, scope);
      if (cursor && !cursor.context) invalidCursor();
      const since =
        cursor?.context?.since ??
        new Date(Date.now() - (options.hours ?? 24) * 3600000).toISOString();
      const query = this.repo
        .createQueryBuilder('delivery')
        .where('delivery.tenant_id = :tenantId', { tenantId })
        .andWhere('delivery.created_at > :since', { since });
      if (options.environment)
        query.andWhere('delivery.environment = :environment', {
          environment: options.environment,
        });
      return queryCursorPage(
        query,
        options,
        scope,
        (entity) => this.toDomain(entity),
        { context: { since } },
      );
    });
  }
  async getStats(
    tenantId: string,
    since: Date,
    environment?: WebhookDelivery['environment'],
  ) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('delivery')
        .where('delivery.tenant_id = :tenantId', { tenantId })
        .andWhere('delivery.created_at > :since', { since });
      if (environment)
        query.andWhere('delivery.environment = :environment', { environment });
      query.select('COUNT(*)', 'total');
      for (const status of ['sent', 'failed', 'pending', 'delayed'])
        query.addSelect(
          `COUNT(*) FILTER (WHERE delivery.status = '${status}')`,
          status,
        );
      const row = await query.getRawOne<Record<string, string>>();
      return {
        total: Number(row?.total ?? 0),
        sent: Number(row?.sent ?? 0),
        failed: Number(row?.failed ?? 0),
        pending: Number(row?.pending ?? 0),
        delayed: Number(row?.delayed ?? 0),
      };
    });
  }

  constructor(
    @InjectRepository(WebhookDeliveryOrmEntity)
    private readonly repo: Repository<WebhookDeliveryOrmEntity>,
  ) {}

  private toDomain(entity: WebhookDeliveryOrmEntity): WebhookDelivery {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      webhookConfigId: entity.webhookConfigId,
      eventType: entity.eventType,
      environment: entity.environment as WebhookDelivery['environment'],
      url: entity.url,
      payload: entity.payload as WebhookDelivery['payload'],
      statusCode: entity.statusCode,
      responseBody: entity.responseBody,
      errorMessage: entity.errorMessage,
      status: entity.status as WebhookDeliveryStatus,
      durationMs: entity.durationMs,
      retryCount: entity.retryCount,
      nextRetryAt: entity.nextRetryAt,
      lastError: entity.lastError,
      createdAt: entity.createdAt,
    };
  }

  private readonly toDomainBound = this.toDomain.bind(this);

  async findByTenantId(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      since?: Date;
      environment?: WebhookDelivery['environment'];
    },
  ): Promise<WebhookDelivery[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const where: any = { tenantId };
      if (options?.since) {
        where.createdAt = MoreThan(options.since);
      }
      if (options?.environment) where.environment = options.environment;
      const entities = await this.repo.find({
        where,
        order: { createdAt: 'DESC' },
        skip: options?.offset || 0,
        take: options?.limit || 50,
      });
      return entities.map(this.toDomainBound);
    });
  }

  async save(
    delivery: WebhookDelivery,
    tenantId: string,
  ): Promise<WebhookDelivery> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, delivery.tenantId);
      const entity = this.repo.create({
        id: delivery.id,
        tenantId: delivery.tenantId,
        webhookConfigId: delivery.webhookConfigId,
        eventType: delivery.eventType,
        environment: delivery.environment,
        url: delivery.url,
        payload: delivery.payload as Record<string, unknown> | undefined,
        statusCode: delivery.statusCode,
        responseBody: delivery.responseBody,
        errorMessage: delivery.errorMessage,
        status: delivery.status,
        durationMs: delivery.durationMs,
        retryCount: delivery.retryCount,
        nextRetryAt: delivery.nextRetryAt,
        lastError: delivery.lastError,
      });
      // Use .insert() (not .save()) to avoid the SubjectDatabaseEntityLoader
      // preload that triggers `WHERE id = ''` when entities have relations.
      await this.repo.insert(entity as any);
      return this.toDomainBound(entity);
    });
  }

  async count(tenantId: string, since: Date): Promise<number> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.count({
        where: { tenantId, createdAt: MoreThan(since) },
      });
    });
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<WebhookDelivery | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({ where: { id, tenantId } });
      return entity ? this.toDomainBound(entity) : null;
    });
  }

  async findPendingDeliveries(
    tenantId: string,
    now: Date,
  ): Promise<WebhookDelivery[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.repo.find({
        where: [
          {
            tenantId,
            status: In(['pending', 'delayed', 'manual_retry']),
            nextRetryAt: LessThanOrEqual(now),
          },
        ],
        order: { nextRetryAt: 'ASC', createdAt: 'ASC' },
        take: 100,
      });
      return entities.map(this.toDomainBound);
    });
  }

  async claimDelivery(
    id: string,
    tenantId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.repo.update(
        {
          id,
          tenantId,
          status: In(['pending', 'delayed', 'manual_retry']),
          nextRetryAt: LessThanOrEqual(now),
        },
        { nextRetryAt: leaseUntil },
      );
      return (result.affected ?? 0) > 0;
    });
  }

  async update(
    id: string,
    tenantId: string,
    fields: Partial<
      Pick<
        WebhookDelivery,
        | 'status'
        | 'retryCount'
        | 'nextRetryAt'
        | 'lastError'
        | 'durationMs'
        | 'statusCode'
        | 'responseBody'
        | 'errorMessage'
      >
    >,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const updateData: Record<string, any> = {};
      if (fields.status !== undefined) updateData.status = fields.status;
      if (fields.retryCount !== undefined)
        updateData.retryCount = fields.retryCount;
      if (fields.nextRetryAt !== undefined)
        updateData.nextRetryAt = fields.nextRetryAt;
      if (fields.lastError !== undefined)
        updateData.lastError = fields.lastError;
      if (fields.durationMs !== undefined)
        updateData.durationMs = fields.durationMs;
      if (fields.statusCode !== undefined)
        updateData.statusCode = fields.statusCode;
      if (fields.responseBody !== undefined)
        updateData.responseBody = fields.responseBody;
      if (fields.errorMessage !== undefined)
        updateData.errorMessage = fields.errorMessage;

      if (Object.keys(updateData).length > 0) {
        await this.repo.update({ id, tenantId }, updateData);
      }
    });
  }
}
