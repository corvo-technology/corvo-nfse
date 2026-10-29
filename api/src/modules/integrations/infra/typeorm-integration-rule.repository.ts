import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { IntegrationRule } from '../domain/integration-rule';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import { IntegrationRuleOrmEntity } from './integration-rule.orm-entity';

@Injectable()
export class TypeOrmIntegrationRuleRepository extends IIntegrationRuleRepository {
  constructor(
    @InjectRepository(IntegrationRuleOrmEntity)
    private readonly repo: Repository<IntegrationRuleOrmEntity>,
  ) {
    super();
  }

  countByConnection(connectionId: string, tenantId: string): Promise<number> {
    return runWithTenant(tenantId, () =>
      this.repo.count({ where: { connectionId, tenantId } }),
    );
  }

  listByConnection(
    connectionId: string,
    tenantId: string,
  ): Promise<IntegrationRule[]> {
    return runWithTenant(tenantId, async () =>
      (
        await this.repo.find({
          where: { connectionId, tenantId },
          order: { createdAt: 'ASC' },
        })
      ).map((row) => ({ ...row })),
    );
  }

  replaceForConnection(
    connectionId: string,
    tenantId: string,
    rules: Array<Omit<IntegrationRule, 'id' | 'tenantId' | 'connectionId'>>,
  ): Promise<IntegrationRule[]> {
    return runWithTenant(tenantId, () =>
      this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(IntegrationRuleOrmEntity);
        await repo.delete({ connectionId, tenantId });
        const saved = await repo.save(
          rules.map((rule) => repo.create({ ...rule, connectionId, tenantId })),
        );
        return saved.map((row) => ({ ...row }));
      }),
    );
  }
}
