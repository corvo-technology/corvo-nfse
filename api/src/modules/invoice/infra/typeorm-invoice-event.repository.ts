import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InvoiceEvent } from '../domain/invoice-event';
import { IInvoiceEventRepository } from '../domain/invoice.repository';
import { InvoiceEventMapper } from './invoice-event.mapper';
import { InvoiceEventOrmEntity } from './invoice-event.orm-entity';

@Injectable()
export class TypeOrmInvoiceEventRepository implements IInvoiceEventRepository {
  private readonly mapper = new InvoiceEventMapper();

  async listPage(
    invoiceId: string,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<InvoiceEvent>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.repo
          .createQueryBuilder('event')
          .innerJoin(
            InvoiceOrmEntity,
            'invoice',
            'invoice.id = event.invoice_id',
          )
          .where(
            'event.invoice_id = :invoiceId AND invoice.tenant_id = :tenantId',
            { invoiceId, tenantId },
          ),
        options,
        ['invoice-events', tenantId, invoiceId],
        (entity) => this.mapper.toDomain(entity),
        { direction: 'ASC' },
      );
    });
  }

  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get repo(): Repository<InvoiceEventOrmEntity> {
    return this.db.repository(InvoiceEventOrmEntity);
  }

  async save(event: InvoiceEvent, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      const orm = this.mapper.toPersistence(event);
      requireTenantId(tenantId);
      await this.repo
        .createQueryBuilder()
        .insert()
        .values({
          ...orm,
          invoiceId: () =>
            this.repo
              .createQueryBuilder()
              .subQuery()
              .select('invoice.id')
              .from(InvoiceOrmEntity, 'invoice')
              .where(
                'invoice.id = :invoiceId AND invoice.tenant_id = :tenantId',
              )
              .getQuery(),
        })
        .setParameters({ invoiceId: event.invoiceId, tenantId })
        .execute();
    });
  }

  async savePortalEntry(
    event: InvoiceEvent,
    tenantId: string,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values({
          ...this.mapper.toPersistence(event),
          invoiceId: () =>
            this.repo
              .createQueryBuilder()
              .subQuery()
              .select('invoice.id')
              .from(InvoiceOrmEntity, 'invoice')
              .where(
                'invoice.id = :invoiceId AND invoice.tenant_id = :tenantId',
              )
              .getQuery(),
        })
        .orIgnore()
        .setParameters({ invoiceId: event.invoiceId, tenantId })
        .execute();
      return (result.raw as unknown[]).length > 0;
    });
  }

  async findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<InvoiceEvent[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.repo
        .createQueryBuilder('event')
        .innerJoin(InvoiceOrmEntity, 'invoice', 'invoice.id = event.invoice_id')
        .where(
          'event.invoice_id = :invoiceId AND invoice.tenant_id = :tenantId',
          { invoiceId, tenantId },
        )
        .orderBy('event.created_at', 'ASC')
        .getMany();
      return entities.map((entity) => this.mapper.toDomain(entity));
    });
  }
}
