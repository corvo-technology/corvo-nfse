import type { DocumentRef } from '@/modules/fiscal-core/domain/document-type';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  CreditTransaction,
  CreateCreditTransaction,
} from '../domain/credit-transaction';
import { ICreditTransactionRepository } from '../domain/credit-transaction.repository';
import { CreditTransactionMapper } from './credit-transaction.mapper';
import { CreditTransactionOrmEntity } from './credit-transaction.orm-entity';

@Injectable()
export class TypeOrmCreditTransactionRepository implements ICreditTransactionRepository {
  private readonly mapper = new CreditTransactionMapper();

  async listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<CreditTransaction>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.repo
          .createQueryBuilder('tx')
          .where('tx.tenant_id = :tenantId', { tenantId }),
        options,
        ['credit-history', tenantId],
        (entity) => this.mapper.toDomain(entity),
      );
    });
  }

  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get repo(): Repository<CreditTransactionOrmEntity> {
    return this.db.repository(CreditTransactionOrmEntity);
  }

  async findByTenantId(
    tenantId: string,
    offset = 0,
    limit = 50,
  ): Promise<CreditTransaction[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
        skip: offset,
        take: limit,
      });
      return entities.map((e) => this.mapper.toDomain(e));
    });
  }

  async save(
    input: CreateCreditTransaction,
    tenantId: string,
  ): Promise<CreditTransaction> {
    return runWithTenant(tenantId, async () => {
      // Domain generates the id; persistence only writes.
      assertTenantOwnership(tenantId, input.tenantId);
      const aggregate = CreditTransaction.create(input);
      await this.repo.insert(this.mapper.toPersistence(aggregate) as any);
      return aggregate;
    });
  }

  async calculateBalance(tenantId: string): Promise<number> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.repo
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.amount), 0)', 'balance')
        .where('tx.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      return parseInt(result?.balance || '0', 10);
    });
  }

  async findByReservedInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<CreditTransaction | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({
        where: {
          reservedInvoiceId: invoiceId,
          tenantId,
          isReservation: true,
        },
      });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async findByReservedDocument(
    ref: DocumentRef,
  ): Promise<CreditTransaction | null> {
    if (ref.type === 'nfse')
      return this.findByReservedInvoiceId(ref.id, ref.tenantId);
    if (ref.type !== 'nfe')
      throw new Error(`No credit reservation for ${ref.type}`);
    return runWithTenant(ref.tenantId, async () => {
      requireTenantId(ref.tenantId);
      const entity = await this.repo.findOne({
        where: {
          reservedNfeDocumentId: ref.id,
          tenantId: ref.tenantId,
          isReservation: true,
        },
      });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async confirm(id: string, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo.update({ id, tenantId }, { isReservation: false });
    });
  }

  async cancelReservation(id: string, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      // Mark as cancelled by setting isReservation to false
      // The original transaction remains, and a refund transaction is created separately
      await this.repo.update({ id, tenantId }, { isReservation: false });
    });
  }
}
