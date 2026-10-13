import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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

  constructor(
    @InjectRepository(InvoiceEventOrmEntity)
    private readonly repo: Repository<InvoiceEventOrmEntity>,
  ) {}

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
            `(SELECT i.id FROM ${this.repo.manager.getRepository(InvoiceOrmEntity).metadata.tablePath} i WHERE i.id = :invoiceId AND i.tenant_id = :tenantId)`,
        })
        .setParameters({ invoiceId: event.invoiceId, tenantId })
        .execute();
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
