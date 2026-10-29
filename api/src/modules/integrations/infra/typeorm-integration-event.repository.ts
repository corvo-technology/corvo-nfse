import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  IIntegrationEventRepository,
  type NewIntegrationEvent,
} from '../domain/integration-event.repository';
import { IntegrationEventOrmEntity } from './integration-event.orm-entity';

@Injectable()
export class TypeOrmIntegrationEventRepository extends IIntegrationEventRepository {
  constructor(
    @InjectRepository(IntegrationEventOrmEntity)
    private readonly repo: Repository<IntegrationEventOrmEntity>,
  ) {
    super();
  }

  insertReceived(
    input: NewIntegrationEvent,
  ): Promise<{ id: string; created: boolean }> {
    return runWithTenant(input.tenantId, async () => {
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values({
          ...input,
          lastError: input.lastError ?? null,
          attempts: 0,
          nextAttemptAt: () => 'now()',
        })
        .orIgnore()
        .returning('id')
        .execute();
      const rows = result.raw as Array<{ id: string }>;
      return rows.length > 0
        ? { id: rows[0].id, created: true }
        : { id: '', created: false };
    });
  }
}
