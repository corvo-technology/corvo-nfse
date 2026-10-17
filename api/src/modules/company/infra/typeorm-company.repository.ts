import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { CertificateOrmEntity } from '@/modules/certificate/infra/certificate.orm-entity';
import {
  persistTenantEntity,
  requireTenantId,
  assertTenantOwnership,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { UnprocessableEntityException } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ICompanyRepository } from '../domain/company.repository';
import { Company } from '../domain/company';
import { CompanyMapper } from './company.mapper';
import { CompanyOrmEntity } from './company.orm-entity';

@Injectable()
export class TypeOrmCompanyRepository implements ICompanyRepository {
  private readonly mapper = new CompanyMapper();

  async listPage(
    tenantId: string,
    options: CursorQuery,
    environment: ExecutionEnvironment,
  ): Promise<CursorPage<Company>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('company')
        .where('company.tenant_id = :tenantId', { tenantId })
        .andWhere('company.environment = :environment', { environment })
        .andWhere('company.deleted_at IS NULL');
      return queryCursorPage(
        query,
        options,
        ['companies', tenantId, environment],
        (entity) => this.mapper.toDomain(entity),
      );
    });
  }

  constructor(
    @InjectRepository(CompanyOrmEntity)
    private readonly repo: Repository<CompanyOrmEntity>,
  ) {}

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({
        where: {
          id,
          tenantId,
          ...(environment ? { environment } : {}),
          deletedAt: IsNull(),
        },
      });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async findByTenantId(
    tenantId: string,
    limit = 50,
    cursor?: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      let query = this.repo
        .createQueryBuilder('company')
        .where('company.tenant_id = :tenantId', { tenantId })
        .andWhere('company.deleted_at IS NULL')
        .orderBy('company.created_at', 'DESC')
        .addOrderBy('company.id', 'DESC');

      if (environment)
        query.andWhere('company.environment = :environment', { environment });
      if (cursor) {
        const [cursorDate, cursorId] = cursor.split('|');
        query = query.andWhere(
          '(company.created_at < :cursorDate OR (company.created_at = :cursorDate AND company.id < :cursorId))',
          { cursorDate, cursorId },
        );
      }

      const entities = await query.take(limit + 1).getMany();
      return entities.map((e) => this.mapper.toDomain(e));
    });
  }

  async saveWithLimit(
    company: Company,
    maximum: number,
    tenantId: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, company.tenantId);
      await this.repo.manager.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`fiscal:${company.tenantId}`],
        );
        const repo = manager.getRepository(CompanyOrmEntity);
        const count = await repo.count({
          where: {
            tenantId: company.tenantId,
            environment: 'live',
            deletedAt: IsNull(),
          },
        });
        if (count >= maximum)
          throw new UnprocessableEntityException({
            message: 'Company limit exceeded',
            reason: 'company_limit_exceeded',
          });
        await repo.insert(this.mapper.toPersistence(company));
      });
    });
  }

  async save(company: Company, tenantId: string): Promise<Company> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await persistTenantEntity(
        this.repo,
        this.mapper.toPersistence(company) as CompanyOrmEntity,
        tenantId,
        ['environment'],
      );
      return company;
    });
  }

  async findByTaxIdAndTenantId(
    taxId: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({
        where: {
          taxId,
          tenantId,
          ...(environment ? { environment } : {}),
          deletedAt: IsNull(),
        },
      });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async existsWithTaxId(
    taxId: string,
    tenantId: string,
    excludeId?: string,
    environment?: ExecutionEnvironment,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('company')
        .select('1')
        .where('company.tax_id = :taxId', { taxId })
        .andWhere('company.tenant_id = :tenantId', { tenantId })
        .andWhere('company.deleted_at IS NULL');

      if (environment)
        query.andWhere('company.environment = :environment', { environment });
      if (excludeId) {
        query.andWhere('company.id != :excludeId', { excludeId });
      }

      const result = await query.getRawOne();
      return result !== undefined;
    });
  }

  async countActiveByTenantId(tenantId: string): Promise<number> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.repo.count({
        where: { tenantId, environment: 'live', deletedAt: IsNull() },
      });
    });
  }

  async batchRecomputeStatus(
    companyIds: string[],
    tenantId: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      if (companyIds.length === 0) return;
      // Single UPDATE — recompute status for each company based on
      // the active certificate. Never touches blocked companies.
      const companyTable = this.repo.metadata.tablePath;
      const certificateTable =
        this.repo.manager.getRepository(CertificateOrmEntity).metadata
          .tablePath;
      await this.repo.query(
        `UPDATE ${companyTable} c
       SET status = CASE
             WHEN EXISTS (
                SELECT 1 FROM ${certificateTable} k
                WHERE k.company_id = c.id
                  AND k.status = 'active'
                  AND k.deleted_at IS NULL
                  AND k.valid_until > now())
             THEN 'ready' ELSE 'pending_setup' END,
           updated_at = now()
       WHERE c.id = ANY($1::uuid[]) AND c.tenant_id = $2
         AND c.status <> 'blocked'
         AND c.deleted_at IS NULL
         AND c.status <> CASE
             WHEN EXISTS (
                SELECT 1 FROM ${certificateTable} k
                WHERE k.company_id = c.id
                  AND k.status = 'active'
                  AND k.deleted_at IS NULL
                  AND k.valid_until > now())
             THEN 'ready' ELSE 'pending_setup' END`,
        [companyIds, tenantId],
      );
    });
  }
}
