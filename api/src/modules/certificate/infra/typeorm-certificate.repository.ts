import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Certificate } from '../domain/certificate';
import {
  ICertificateRepository,
  type ExpiringCertificate,
} from '../domain/certificate.repository';
import { CertificateMapper } from './certificate.mapper';
import { CertificateOrmEntity } from './certificate.orm-entity';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';

@Injectable()
export class TypeOrmCertificateRepository implements ICertificateRepository {
  private readonly mapper = new CertificateMapper();
  constructor(
    @InjectRepository(CertificateOrmEntity)
    private readonly repo: Repository<CertificateOrmEntity>,
  ) {}
  private scoped(tenantId: string, environment?: ExecutionEnvironment) {
    return runWithTenant(tenantId, () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('cert')
        .innerJoin(CompanyOrmEntity, 'company', 'company.id = cert.company_id')
        .where('company.tenant_id = :tenantId', { tenantId })
        .andWhere('company.deleted_at IS NULL')
        .andWhere('cert.deleted_at IS NULL');
      if (environment)
        query.andWhere('company.environment = :environment', { environment });
      return query;
    });
  }
  async listPage(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options: CursorQuery,
  ): Promise<CursorPage<Certificate>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.scoped(tenantId, environment).andWhere(
          'cert.company_id = :companyId',
          { companyId },
        ),
        options,
        ['certificates', tenantId, environment, companyId],
        (entity) => this.mapper.toDomain(entity),
      );
    });
  }
  async findById(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Certificate | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.scoped(tenantId, environment)
        .andWhere('cert.id = :id', { id })
        .getOne();
      return row ? this.mapper.toDomain(row) : null;
    });
  }
  async findByIdAndCompanyId(
    id: string,
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Certificate | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.scoped(tenantId, environment)
        .andWhere('cert.id = :id AND cert.company_id = :companyId', {
          id,
          companyId,
        })
        .getOne();
      return row ? this.mapper.toDomain(row) : null;
    });
  }
  async findActiveByCompanyId(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Certificate | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.scoped(tenantId, environment)
        .andWhere("cert.company_id = :companyId AND cert.status = 'active'", {
          companyId,
        })
        .getOne();
      return row ? this.mapper.toDomain(row) : null;
    });
  }
  async save(
    certificate: Certificate,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Certificate> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const company = await this.repo.manager
        .getRepository(CompanyOrmEntity)
        .findOneBy({ id: certificate.companyId, tenantId, environment });
      if (!company || company.deletedAt)
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
        });
      const row = this.mapper.toPersistence(certificate);
      const { id, companyId, createdAt: _createdAt, ...mutable } = row;
      const parent = this.repo.manager
        .getRepository(CompanyOrmEntity)
        .createQueryBuilder('company')
        .select('1')
        .where(
          'company.id = company_id AND company.tenant_id = :tenantId AND company.environment = :environment AND company.deleted_at IS NULL',
          { tenantId, environment },
        );
      const updated = await this.repo
        .createQueryBuilder()
        .update()
        .set(mutable)
        .where({ id, companyId })
        .andWhere(`EXISTS (${parent.getQuery()})`)
        .setParameters(parent.getParameters())
        .execute();
      if (!updated.affected) {
        await this.repo
          .createQueryBuilder()
          .insert()
          .values({
            ...row,
            companyId: () =>
              `(SELECT company.id FROM ${this.repo.manager.getRepository(CompanyOrmEntity).metadata.tablePath} company WHERE company.id = :companyId AND company.tenant_id = :tenantId AND company.environment = :environment AND company.deleted_at IS NULL)`,
          })
          .setParameters({ companyId, tenantId, environment })
          .execute();
      }
      return certificate;
    });
  }
  async existsActiveForCompany(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.scoped(tenantId, environment)
        .andWhere("cert.company_id = :companyId AND cert.status = 'active'", {
          companyId,
        })
        .getExists();
    });
  }
  async expireExpiredCertificates(tenantId: string): Promise<string[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const cert = this.repo.metadata.tablePath;
      const company =
        this.repo.manager.getRepository(CompanyOrmEntity).metadata.tablePath;
      const [rows] = await this.repo.query<
        [Array<{ company_id: string }>, number]
      >(
        `UPDATE ${cert} k SET status = 'expired' WHERE k.status = 'active' AND k.deleted_at IS NULL AND k.valid_until <= now() AND EXISTS (SELECT 1 FROM ${company} c WHERE c.id = k.company_id AND c.tenant_id = $1 AND c.deleted_at IS NULL) RETURNING company_id`,
        [tenantId],
      );
      return rows.map((row) => row.company_id);
    });
  }

  async findExpiringSoon(
    tenantId: string,
    days: number,
  ): Promise<ExpiringCertificate[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const cert = this.repo.metadata.tablePath;
      const company =
        this.repo.manager.getRepository(CompanyOrmEntity).metadata.tablePath;
      const rows = await this.repo.query<
        Array<{ company_id: string; company_name: string; valid_until: Date }>
      >(
        `SELECT k.company_id, COALESCE(c.trade_name, c.legal_name) AS company_name, k.valid_until FROM ${cert} k JOIN ${company} c ON c.id = k.company_id WHERE k.status = 'active' AND k.deleted_at IS NULL AND k.valid_until > now() AND k.valid_until <= now() + make_interval(days => $2) AND c.tenant_id = $1 AND c.deleted_at IS NULL AND c.environment = 'live'`,
        [tenantId, days],
      );
      return rows.map((row) => ({
        companyId: row.company_id,
        companyName: row.company_name,
        validUntil: new Date(row.valid_until),
      }));
    });
  }
}
