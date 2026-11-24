import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { persistTenantEntity } from '@/infra/persistence/typeorm/tenant-scope';
import type { IntegrationConnection } from '../domain/integration-connection';
import { IIntegrationConnectionRepository } from '../domain/integration-connection.repository';
import { IntegrationConnectionOrmEntity } from './integration-connection.orm-entity';

@Injectable()
export class TypeOrmIntegrationConnectionRepository extends IIntegrationConnectionRepository {
  constructor(
    @InjectRepository(IntegrationConnectionOrmEntity)
    private readonly repo: Repository<IntegrationConnectionOrmEntity>,
  ) {
    super();
  }

  insert(connection: IntegrationConnection): Promise<IntegrationConnection> {
    return runWithTenant(connection.tenantId, async () => {
      const row = this.repo.create(connection);
      await this.repo.insert(row);
      return this.toDomain(row);
    });
  }

  update(connection: IntegrationConnection): Promise<IntegrationConnection> {
    return runWithTenant(connection.tenantId, async () =>
      this.toDomain(
        await persistTenantEntity(
          this.repo,
          this.repo.create(connection),
          connection.tenantId,
        ),
      ),
    );
  }

  findById(
    id: string,
    tenantId: string,
  ): Promise<IntegrationConnection | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.repo.findOne({ where: { id, tenantId } });
      return row ? this.toDomain(row) : null;
    });
  }

  listByTenant(tenantId: string): Promise<IntegrationConnection[]> {
    return runWithTenant(tenantId, async () =>
      (
        await this.repo.find({
          where: { tenantId },
          order: { createdAt: 'DESC' },
        })
      ).map((row) => this.toDomain(row)),
    );
  }

  findByPublicId(publicId: string): Promise<IntegrationConnection | null> {
    return runAsSystem('integration-inbound', async () => {
      const row = await this.repo.findOne({ where: { publicId } });
      return row ? this.toDomain(row) : null;
    });
  }

  private toDomain(row: IntegrationConnectionOrmEntity): IntegrationConnection {
    return { ...row, state: row.state as IntegrationConnection['state'] };
  }
}
