import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, Logger } from '@nestjs/common';
import { Repository, Not, type FindOptionsWhere } from 'typeorm';
import { Invoice, LastEmailStatus } from '../domain/invoice';
import {
  CancellationIntent,
  IInvoiceRepository,
  ListInvoicesFilters,
  SaveInvoiceOptions,
} from '../domain/invoice.repository';
import { InvoiceMapper } from './invoice.mapper';
import { InvoiceOrmEntity } from './invoice.orm-entity';

@Injectable()
export class TypeOrmInvoiceRepository implements IInvoiceRepository {
  private readonly mapper = new InvoiceMapper();
  private readonly logger = new Logger(TypeOrmInvoiceRepository.name);

  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get repo(): Repository<InvoiceOrmEntity> {
    return this.db.repository(InvoiceOrmEntity);
  }

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
    options: { forUpdate?: boolean } = {},
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
      if (options.forUpdate) query.setLock('pessimistic_write');
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

  async insert(invoice: Invoice, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, invoice.tenantId);
      await this.repo.insert(
        this.mapper.toPersistence(
          invoice,
        ) as QueryDeepPartialEntity<InvoiceOrmEntity>,
      );
    });
  }

  async findPendingReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.repo
        .createQueryBuilder('invoice')
        .select(['invoice.id', 'invoice.tenantId', 'invoice.companyId'])
        .where('invoice.tenant_id = :tenantId', { tenantId })
        .andWhere('invoice.status IN (:...statuses)', {
          statuses: ['processing', 'reconciliation_required'],
        })
        .andWhere('invoice.updated_at < :olderThan', { olderThan })
        .take(limit)
        .getMany();
      return rows.map(({ id, tenantId, companyId }) => ({
        id,
        tenantId,
        companyId,
      }));
    });
  }

  async save(
    invoice: Invoice,
    tenantId: string,
    options: SaveInvoiceOptions = {},
  ): Promise<Invoice> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      assertTenantOwnership(tenantId, invoice.tenantId);
      const orm = this.mapper.toPersistence(invoice);
      // Undefined values are skipped by TypeORM, so the stored request survives.
      if (options.preserveCancellationRequest) {
        orm.cancellationReason = undefined;
        orm.cancellationDescription = undefined;
        orm.cancellationRequestedAt = undefined;
      }
      // Settled statuses: no fiscal retry can still need the signed pending XML.
      if (
        ['authorized', 'rejected', 'failed', 'cancelled'].includes(
          invoice.status,
        )
      )
        orm.pendingEmission = null;
      await persistTenantEntity(this.repo, orm, tenantId, [
        'companyId',
        'environment',
      ]);
      return invoice;
    });
  }

  async saveDpsInfo(invoice: Invoice): Promise<void> {
    const snapshot = invoice.toSnapshot();
    return runWithTenant(snapshot.tenantId, async () => {
      requireTenantId(snapshot.tenantId);
      const set: Partial<
        Pick<InvoiceOrmEntity, 'dpsId' | 'dpsSeries' | 'dpsNumber'>
      > = {};
      if (snapshot.dpsId != null) set.dpsId = snapshot.dpsId;
      if (snapshot.dpsSeries != null) set.dpsSeries = snapshot.dpsSeries;
      if (snapshot.dpsNumber != null) set.dpsNumber = snapshot.dpsNumber;
      if (Object.keys(set).length === 0) return;
      await this.repo
        .createQueryBuilder()
        .update()
        .set(set)
        .where('id = :id AND tenant_id = :tenantId', {
          id: snapshot.id,
          tenantId: snapshot.tenantId,
        })
        .execute();
    });
  }

  async registerCancellationIntent(
    invoiceId: string,
    tenantId: string,
    intent: CancellationIntent,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.repo
        .createQueryBuilder()
        .update()
        .set({
          cancellationReason: intent.code,
          cancellationDescription: intent.description,
          cancellationRequestedAt: intent.requestedAt,
        })
        .where('id = :id AND tenant_id = :tenantId', {
          id: invoiceId,
          tenantId,
        })
        .andWhere("status = 'processing'")
        .andWhere('cancellation_requested_at IS NULL')
        .execute();
      return (result.affected ?? 0) === 1;
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
        .where(
          'invoice.status IN (:...statuses) AND invoice.tenant_id = :tenantId',
          {
            statuses: ['authorized', 'cancelling', 'cancelled'],
            tenantId,
          },
        )
        .andWhere(
          "(invoice.documents_ready_at IS NULL OR (invoice.status = 'authorized' AND invoice.email_snapshot->>'send' = 'true' AND invoice.last_email_status IS NULL))",
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
