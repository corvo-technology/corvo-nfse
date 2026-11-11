import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { CertificateOrmEntity } from '@/modules/certificate/infra/certificate.orm-entity';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  IPortalSyncRepository,
  type NewPortalDocument,
  type PortalSyncCursor,
  type PortalSyncCursorUpdate,
  type StoredPortalDocument,
  type SyncTarget,
} from '../domain/portal-sync.repository';
import { PortalDocumentOrmEntity } from './portal-document.orm-entity';
import { PortalSyncCursorOrmEntity } from './portal-sync-cursor.orm-entity';

@Injectable()
export class TypeOrmPortalSyncRepository extends IPortalSyncRepository {
  constructor(@InjectDataSource() private readonly database: DataSource) {
    super();
  }

  private cursors() {
    return this.database.getRepository(PortalSyncCursorOrmEntity);
  }

  private documents() {
    return this.database.getRepository(PortalDocumentOrmEntity);
  }

  async listTargets(tenantId: string): Promise<SyncTarget[]> {
    return runWithTenant(tenantId, () =>
      this.database
        .getRepository(CompanyOrmEntity)
        .createQueryBuilder('company')
        .innerJoin(
          CertificateOrmEntity,
          'cert',
          "cert.company_id = company.id AND cert.status = 'active' AND cert.deleted_at IS NULL AND cert.valid_until > now()",
        )
        .where('company.tenant_id = :tenantId AND company.deleted_at IS NULL', {
          tenantId,
        })
        .select('company.id', 'companyId')
        .addSelect('company.environment', 'environment')
        .orderBy('company.id', 'ASC')
        .getRawMany<{ companyId: string; environment: ExecutionEnvironment }>(),
    );
  }

  async findCursor(
    tenantId: string,
    target: SyncTarget,
  ): Promise<PortalSyncCursor | null> {
    const row = await runWithTenant(tenantId, () =>
      this.cursors().findOne({
        where: {
          tenantId,
          companyId: target.companyId,
          environment: target.environment,
        },
      }),
    );
    return row
      ? {
          lastNsu: Number(row.lastNsu),
          firstRoundDoneAt: row.firstRoundDoneAt,
          nextRunAt: row.nextRunAt,
          idleRuns: row.idleRuns,
          failures: row.failures,
        }
      : null;
  }

  async createCursor(
    tenantId: string,
    target: SyncTarget,
    nextRunAt: Date,
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.cursors()
        .createQueryBuilder()
        .insert()
        .values({
          tenantId,
          companyId: target.companyId,
          environment: target.environment,
          nextRunAt,
        })
        .orIgnore()
        .execute(),
    );
  }

  async updateCursor(
    tenantId: string,
    target: SyncTarget,
    update: PortalSyncCursorUpdate,
  ): Promise<void> {
    const { lastNsu, ...rest } = update;
    await runWithTenant(tenantId, () =>
      this.cursors()
        .createQueryBuilder()
        .update()
        .set({
          ...rest,
          ...(lastNsu === undefined ? {} : { lastNsu: String(lastNsu) }),
          updatedAt: new Date(),
        })
        .where(
          'tenant_id = :tenantId AND company_id = :companyId AND environment = :environment',
          { tenantId, ...target },
        )
        .execute(),
    );
  }

  async saveDocument(
    tenantId: string,
    target: SyncTarget,
    document: NewPortalDocument,
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.documents()
        .createQueryBuilder()
        .insert()
        .values({
          tenantId,
          companyId: target.companyId,
          environment: target.environment,
          nsu: String(document.nsu),
          accessKey: document.accessKey,
          documentType: document.documentType,
          eventType: document.eventType,
          xml: document.xml,
          generatedAt: document.generatedAt,
        })
        .orIgnore()
        .execute(),
    );
  }

  async listUnprocessed(
    tenantId: string,
    target: SyncTarget,
    maxAttempts: number,
    limit: number,
  ): Promise<StoredPortalDocument[]> {
    const rows = await runWithTenant(tenantId, () =>
      this.documents()
        .createQueryBuilder('doc')
        .where(
          'doc.tenant_id = :tenantId AND doc.company_id = :companyId AND doc.environment = :environment',
          { tenantId, ...target },
        )
        .andWhere('doc.processed_at IS NULL AND doc.attempts < :maxAttempts', {
          maxAttempts,
        })
        .orderBy('doc.nsu', 'ASC')
        .limit(limit)
        .getMany(),
    );
    return rows.map((row) => ({
      id: row.id,
      nsu: Number(row.nsu),
      accessKey: row.accessKey,
      documentType: row.documentType,
      eventType: row.eventType,
      xml: row.xml,
      generatedAt: row.generatedAt,
      attempts: row.attempts,
    }));
  }

  async markProcessed(tenantId: string, documentId: string): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.documents().update(
        { id: documentId, tenantId },
        { processedAt: new Date(), lastError: null },
      ),
    );
  }

  async markFailed(
    tenantId: string,
    documentId: string,
    error: string,
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.documents()
        .createQueryBuilder()
        .update()
        .set({ attempts: () => 'attempts + 1', lastError: error.slice(0, 500) })
        .where('id = :documentId AND tenant_id = :tenantId', {
          documentId,
          tenantId,
        })
        .execute(),
    );
  }
}
