import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, type FindOptionsWhere } from 'typeorm';
import { Invoice, LastEmailStatus } from '../domain/invoice';
import {
  IInvoiceRepository,
  ListInvoicesFilters,
} from '../domain/invoice.repository';
import { InvoiceMapper } from './invoice.mapper';
import { InvoiceOrmEntity } from './invoice.orm-entity';

@Injectable()
export class TypeOrmInvoiceRepository implements IInvoiceRepository {
  private readonly mapper = new InvoiceMapper();
  private readonly logger = new Logger(TypeOrmInvoiceRepository.name);

  constructor(
    @InjectRepository(InvoiceOrmEntity)
    private readonly repo: Repository<InvoiceOrmEntity>,
  ) {}

  async findByAccessKeyAndTenantId(
    accessKey: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Invoice | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.repo.findOne({
        where: { accessKey, tenantId, environment },
      });
      return row ? this.mapper.toDomain(row) : null;
    });
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Invoice | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.repo
        .createQueryBuilder('invoice')
        .where('invoice.id = :id AND invoice.tenant_id = :tenantId', {
          id,
          tenantId,
        });
      if (environment)
        query.andWhere('invoice.environment = :environment', { environment });
      const entity = await query.getOne();
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async findByIdempotencyKey(
    key: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Invoice | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({
        where: {
          idempotencyKey: key,
          tenantId,
          ...(environment ? { environment } : {}),
        },
      });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async listPage(
    tenantId: string,
    filters: ListInvoicesFilters,
    options: CursorQuery,
  ): Promise<CursorPage<Invoice>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const queryBuilder = this.repo
        .createQueryBuilder('invoice')
        .where('invoice.tenant_id = :tenantId', { tenantId });

      if (filters?.environment)
        queryBuilder.andWhere('invoice.environment = :environment', {
          environment: filters.environment,
        });
      if (filters?.companyId) {
        queryBuilder.andWhere('invoice.company_id = :companyId', {
          companyId: filters.companyId,
        });
      }
      if (filters?.status) {
        queryBuilder.andWhere('invoice.status = :status', {
          status: filters.status,
        });
      }
      if (filters?.externalId) {
        queryBuilder.andWhere('invoice.external_id = :externalId', {
          externalId: filters.externalId,
        });
      }
      if (filters?.from) {
        queryBuilder.andWhere('invoice.competence_date >= :from', {
          from: filters.from,
        });
      }
      if (filters?.to) {
        queryBuilder.andWhere('invoice.competence_date <= :to', {
          to: filters.to,
        });
      }
      return queryCursorPage(
        queryBuilder,
        options,
        ['invoices', tenantId, filters],
        (entity) => this.mapper.toDomain(entity),
      );
    });
  }

  async findByTenantId(
    tenantId: string,
    filters?: ListInvoicesFilters,
    limit = 50,
    cursor?: string,
  ): Promise<Invoice[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const queryBuilder = this.repo
        .createQueryBuilder('invoice')
        .where('invoice.tenant_id = :tenantId', { tenantId });

      if (filters?.environment)
        queryBuilder.andWhere('invoice.environment = :environment', {
          environment: filters.environment,
        });
      if (filters?.companyId) {
        queryBuilder.andWhere('invoice.company_id = :companyId', {
          companyId: filters.companyId,
        });
      }
      if (filters?.status) {
        queryBuilder.andWhere('invoice.status = :status', {
          status: filters.status,
        });
      }
      if (filters?.externalId) {
        queryBuilder.andWhere('invoice.external_id = :externalId', {
          externalId: filters.externalId,
        });
      }
      if (filters?.from) {
        queryBuilder.andWhere('invoice.competence_date >= :from', {
          from: filters.from,
        });
      }
      if (filters?.to) {
        queryBuilder.andWhere('invoice.competence_date <= :to', {
          to: filters.to,
        });
      }
      if (cursor) {
        queryBuilder.andWhere('invoice.created_at < :cursor', { cursor });
      }

      const entities = await queryBuilder
        .orderBy('invoice.created_at', 'DESC')
        .take(limit)
        .getMany();

      return entities.map((e) => this.mapper.toDomain(e));
    });
  }

  async save(invoice: Invoice, tenantId: string): Promise<Invoice> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const orm = this.mapper.toPersistence(invoice);
      await persistTenantEntity(this.repo, orm, tenantId, [
        'companyId',
        'environment',
      ]);
      return invoice;
    });
  }

  async existsIdempotencyKey(
    key: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const where: FindOptionsWhere<InvoiceOrmEntity> = {
        idempotencyKey: key,
        tenantId,
      };
      if (excludeId) {
        where.id = Not(excludeId);
      }
      const count = await this.repo.count({ where });
      return count > 0;
    });
  }

  async markDocumentsReady(
    invoiceId: string,
    tenantId: string,
    at: Date,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.repo
        .createQueryBuilder()
        .update()
        .set({ documentsReadyAt: at })
        .where('id = :invoiceId AND tenant_id = :tenantId', {
          invoiceId,
          tenantId,
        })
        .andWhere('documents_ready_at IS NULL')
        .execute();
      return (result.affected ?? 0) === 1;
    });
  }

  async updateEmailStatus(
    invoiceId: string,
    tenantId: string,
    status: LastEmailStatus,
    sentAt?: Date,
    onlyIfUnset = false,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const update = this.repo
        .createQueryBuilder()
        .update()
        .set({
          lastEmailStatus: status,
          lastEmailSentAt: sentAt ?? undefined,
        })
        .where('id = :invoiceId AND tenant_id = :tenantId', {
          invoiceId,
          tenantId,
        });
      if (onlyIfUnset) update.andWhere('last_email_status IS NULL');
      await update.execute();
    });
  }

  async findAuthorizedWithoutDocuments(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.repo
        .createQueryBuilder('invoice')
        .select(['invoice.id', 'invoice.tenantId', 'invoice.companyId'])
        .where('invoice.status = :status AND invoice.tenant_id = :tenantId', {
          status: 'authorized',
          tenantId,
        })
        .andWhere(
          "(invoice.documents_ready_at IS NULL OR (invoice.email_snapshot->>'send' = 'true' AND invoice.last_email_status IS NULL))",
        )
        .andWhere('invoice.authorized_at < :olderThan', { olderThan })
        .orderBy('invoice.authorized_at', 'ASC')
        .take(limit)
        .getMany();
      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        companyId: r.companyId,
      }));
    });
  }
}
