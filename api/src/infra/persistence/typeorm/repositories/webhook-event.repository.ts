import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Brackets, In } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  ClaimWebhookEventsInput,
  CreateWebhookEventInput,
  IWebhookEventRepository,
  WebhookEvent,
} from '@/modules/webhooks-config/domain/webhook-event.repository';
import { WebhookEventOrmEntity } from '../entities/webhook-event.orm-entity';
import { TypeOrmRepositoryHelper } from '../typeorm-repository.helper';

@Injectable()
export class TypeOrmWebhookEventRepository implements IWebhookEventRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  async create(
    input: CreateWebhookEventInput,
  ): Promise<{ event: WebhookEvent; created: boolean }> {
    const now = input.receivedAt ?? new Date();
    const entity = Object.assign(new WebhookEventOrmEntity(), {
      id: input.id ?? randomUUID(),
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      tenantId: input.tenantId ?? null,
      resourceType: input.resourceType ?? null,
      externalResourceId: input.externalResourceId ?? null,
      payload: input.payload ?? null,
      payloadSha256: input.payloadSha256,
      status: input.status ?? 'received',
      attempts: 0,
      availableAt: input.availableAt ?? now,
      leaseUntil: null,
      lastError: null,
      receivedAt: now,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const result = await this.db
      .repository(WebhookEventOrmEntity)
      .createQueryBuilder()
      .insert()
      .values(
        entity as unknown as QueryDeepPartialEntity<WebhookEventOrmEntity>,
      )
      .orIgnore()
      .execute();
    const persisted = await this.findByProviderEventId(
      input.provider,
      input.providerEventId,
    );
    if (!persisted) {
      throw new Error('Webhook event insert did not return a persisted row');
    }
    return { event: persisted, created: result.identifiers.length > 0 };
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    const entity = await this.db
      .repository(WebhookEventOrmEntity)
      .findOneBy({ id });
    return entity ? toDomain(entity) : null;
  }

  async findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookEvent | null> {
    const entity = await this.db
      .repository(WebhookEventOrmEntity)
      .findOneBy({ provider, providerEventId });
    return entity ? toDomain(entity) : null;
  }

  async claimPending(input: ClaimWebhookEventsInput): Promise<WebhookEvent[]> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    return this.db.manager().transaction(async (manager) => {
      const repository = manager.getRepository(WebhookEventOrmEntity);
      const query = repository
        .createQueryBuilder('event')
        .where(
          new Brackets((where) => {
            where
              .where(
                `event.status IN ('received', 'failed') AND event.available_at <= :now`,
                { now: input.now },
              )
              .orWhere(
                `event.status = 'processing' AND event.lease_until <= :now`,
                { now: input.now },
              );
          }),
        )
        .orderBy('event.received_at', 'ASC')
        .addOrderBy('event.id', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .take(limit);
      if (input.providers?.length) {
        query.andWhere('event.provider IN (:...providers)', {
          providers: input.providers,
        });
      }
      const claimed = await query.getMany();
      if (claimed.length === 0) return [];

      const ids = claimed.map(({ id }) => id);
      await repository.update(
        { id: In(ids) },
        {
          status: 'processing',
          leaseUntil: input.leaseUntil,
          attempts: () => 'attempts + 1',
          lastError: null,
        },
      );
      const refreshed = await repository.findBy({ id: In(ids) });
      const byId = new Map(refreshed.map((event) => [event.id, event]));
      return ids.map((id) => toDomain(byId.get(id)!));
    });
  }

  async markProcessed(id: string, processedAt: Date): Promise<void> {
    await this.complete(id, 'processed', processedAt);
  }

  async markIgnored(
    id: string,
    processedAt: Date,
    reason?: string,
  ): Promise<void> {
    await this.complete(id, 'ignored', processedAt, reason);
  }

  async markFailed(
    id: string,
    error: string,
    availableAt: Date,
  ): Promise<void> {
    await this.db.repository(WebhookEventOrmEntity).update(
      { id },
      {
        status: 'failed',
        availableAt,
        leaseUntil: null,
        lastError: error,
      },
    );
  }

  async markManualReview(id: string, error: string): Promise<void> {
    await this.db.repository(WebhookEventOrmEntity).update(
      { id },
      {
        status: 'manual_review',
        leaseUntil: null,
        lastError: error,
      },
    );
  }

  private async complete(
    id: string,
    status: 'processed' | 'ignored',
    processedAt: Date,
    lastError?: string,
  ): Promise<void> {
    await this.db.repository(WebhookEventOrmEntity).update(
      { id },
      {
        status,
        processedAt,
        leaseUntil: null,
        lastError: lastError ?? null,
      },
    );
  }
}

function toDomain(entity: WebhookEventOrmEntity): WebhookEvent {
  return {
    id: entity.id,
    provider: entity.provider,
    providerEventId: entity.providerEventId,
    eventType: entity.eventType,
    tenantId: entity.tenantId ?? undefined,
    resourceType: entity.resourceType ?? undefined,
    externalResourceId: entity.externalResourceId ?? undefined,
    payload: entity.payload ?? undefined,
    payloadSha256: entity.payloadSha256,
    status: entity.status,
    attempts: entity.attempts,
    availableAt: entity.availableAt,
    leaseUntil: entity.leaseUntil ?? undefined,
    lastError: entity.lastError ?? undefined,
    receivedAt: entity.receivedAt,
    processedAt: entity.processedAt ?? undefined,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
