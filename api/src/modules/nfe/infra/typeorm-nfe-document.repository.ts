import { Injectable } from '@nestjs/common';
import { In, type Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  assertTenantOwnership,
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { CursorPage, type CursorQuery } from '@/shared/http/pagination';
import type { NfeDocument, NfeHistoryEntry } from '../domain/nfe-document';
import {
  INfeDocumentRepository,
  type ListNfeFilters,
} from '../domain/nfe-document.repository';
import type { NfeStatus } from '../domain/nfe-status';
import { NfeDocumentHistoryOrmEntity } from './nfe-document-history.orm-entity';
import { NfeDocumentItemOrmEntity } from './nfe-document-item.orm-entity';
import { NfeDocumentOrmEntity } from './nfe-document.orm-entity';
import { NfeDocumentMapper } from './nfe-document.mapper';

@Injectable()
export class TypeOrmNfeDocumentRepository implements INfeDocumentRepository {
  private readonly mapper = new NfeDocumentMapper();

  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get documents(): Repository<NfeDocumentOrmEntity> {
    return this.db.repository(NfeDocumentOrmEntity);
  }

  private get items(): Repository<NfeDocumentItemOrmEntity> {
    return this.db.repository(NfeDocumentItemOrmEntity);
  }

  async insert(document: NfeDocument): Promise<void> {
    const snapshot = document.toSnapshot();
    return runWithTenant(snapshot.tenantId, async () => {
      await this.documents.insert(
        this.mapper.toPersistence(
          document,
        ) as QueryDeepPartialEntity<NfeDocumentOrmEntity>,
      );
      const items = this.mapper.itemsToPersistence(snapshot);
      if (items.length > 0)
        await this.items.insert(
          items as QueryDeepPartialEntity<NfeDocumentItemOrmEntity>[],
        );
    });
  }

  async save(document: NfeDocument): Promise<void> {
    const { tenantId } = document.toSnapshot();
    return runWithTenant(tenantId, async () => {
      assertTenantOwnership(tenantId, document.tenantId);
      await persistTenantEntity(
        this.documents,
        this.mapper.toPersistence(document),
        tenantId,
        ['companyId', 'environment'],
      );
    });
  }

  async findById(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options: { forUpdate?: boolean } = {},
  ): Promise<NfeDocument | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const query = this.documents
        .createQueryBuilder('doc')
        .where(
          'doc.id = :id AND doc.tenant_id = :tenantId AND doc.environment = :environment',
          { id, tenantId, environment },
        );
      if (options.forUpdate) query.setLock('pessimistic_write');
      const row = await query.getOne();
      return row ? this.hydrate(row) : null;
    });
  }

  async findByIdempotencyKey(
    key: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeDocument | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.documents.findOne({
        where: { idempotencyKey: key, tenantId, environment },
      });
      return row ? this.hydrate(row) : null;
    });
  }

  async findByAccessKey(
    accessKey: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeDocument | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.documents.findOne({
        where: { accessKey, tenantId, environment },
      });
      return row ? this.hydrate(row) : null;
    });
  }

  async list(
    tenantId: string,
    environment: ExecutionEnvironment,
    query: CursorQuery & ListNfeFilters,
  ): Promise<CursorPage<NfeDocument>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const builder = this.documents
        .createQueryBuilder('doc')
        .where('doc.tenant_id = :tenantId AND doc.environment = :environment', {
          tenantId,
          environment,
        });
      if (query.companyId)
        builder.andWhere('doc.company_id = :companyId', {
          companyId: query.companyId,
        });
      if (query.status)
        builder.andWhere('doc.status = :status', {
          status: query.status satisfies NfeStatus,
        });
      const page = await queryCursorPage(
        builder,
        { limit: query.limit, cursor: query.cursor },
        ['nfe', tenantId, environment, query.companyId, query.status],
        (row) => row,
      );
      const itemRows =
        page.data.length === 0
          ? []
          : await this.items.find({
              where: {
                documentId: In(page.data.map((row) => row.id)),
                tenantId,
              },
            });
      return new CursorPage(
        page.data.map((row) =>
          this.mapper.toDomain(
            row,
            itemRows.filter((item) => item.documentId === row.id),
          ),
        ),
        page.pagination,
      );
    });
  }

  async appendHistory(entry: NfeHistoryEntry): Promise<void> {
    return runWithTenant(entry.tenantId, async () => {
      await this.db
        .repository(NfeDocumentHistoryOrmEntity)
        .insert(this.mapper.historyToPersistence(entry));
    });
  }

  async history(
    documentId: string,
    tenantId: string,
  ): Promise<Array<NfeHistoryEntry & { createdAt: Date }>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.db.repository(NfeDocumentHistoryOrmEntity).find({
        where: { documentId, tenantId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return rows.map((row) => ({
        tenantId: row.tenantId,
        documentId: row.documentId,
        fromStatus: row.fromStatus as NfeStatus | null,
        toStatus: row.toStatus as NfeStatus,
        accessKey: row.accessKey,
        attempt: row.attempt,
        cStat: row.cStat,
        xMotivo: row.xMotivo,
        createdAt: row.createdAt,
      }));
    });
  }

  private async hydrate(row: NfeDocumentOrmEntity): Promise<NfeDocument> {
    const items = await this.items.find({
      where: { documentId: row.id, tenantId: row.tenantId },
    });
    return this.mapper.toDomain(row, items);
  }
}
