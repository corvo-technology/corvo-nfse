import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { DpsSequenceOrmEntity } from './dps-sequence.orm-entity';
import { NotFoundException } from '@nestjs/common';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IDpsSequenceRepository } from '../domain/dps-sequence';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

@Injectable()
export class TypeOrmDpsSequenceRepository implements IDpsSequenceRepository {
  private readonly logger = new Logger(TypeOrmDpsSequenceRepository.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async reserveNext(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<{ series: string; number: number }> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const companies = this.dataSource.getMetadata(CompanyOrmEntity).tablePath;
      const sequences =
        this.dataSource.getMetadata(DpsSequenceOrmEntity).tablePath;
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      try {
        // Ensure sequence row exists
        await queryRunner.query(
          `INSERT INTO ${sequences} (company_id, series, current_number) SELECT c.id, '1', 0 FROM ${companies} c WHERE c.id = $1 AND c.tenant_id = $2 AND c.environment = $3 AND c.deleted_at IS NULL ON CONFLICT (company_id) DO NOTHING`,
          [companyId, tenantId, environment],
        );

        // Increment and return
        const result = await queryRunner.query(
          `UPDATE ${sequences} SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND EXISTS (SELECT 1 FROM ${companies} c WHERE c.id = $1 AND c.tenant_id = $2 AND c.environment = $3 AND c.deleted_at IS NULL) RETURNING series, current_number`,
          [companyId, tenantId, environment],
        );

        if (!result[0].length)
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            message: 'Resource not found',
          });
        await queryRunner.commitTransaction();

        return {
          // TypeORM returns [rows, affectedCount] for PostgreSQL UPDATE.
          series: result[0][0].series,
          number: Number(result[0][0].current_number),
        };
      } catch (e) {
        await queryRunner.rollbackTransaction();
        throw e;
      } finally {
        await queryRunner.release();
      }
    });
  }
}
