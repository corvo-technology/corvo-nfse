import {
  CreditTransaction,
  CreditTransactionType,
} from '../domain/credit-transaction';
import { CreditTransactionOrmEntity } from './credit-transaction.orm-entity';

export class CreditTransactionMapper {
  toDomain(orm: CreditTransactionOrmEntity): CreditTransaction {
    return CreditTransaction.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      amount: orm.amount,
      type: orm.type as CreditTransactionType,
      description: orm.description,
      stripeSessionId: orm.stripeSessionId,
      metadata: orm.metadata,
      amountBrlCents: orm.amountBrlCents ?? undefined,
      unitPriceCentsApplied: orm.unitPriceCentsApplied ?? undefined,
      planIdSnapshot: orm.planIdSnapshot ?? undefined,
      source: (orm.source as 'subscription' | 'avulso' | 'bonus') ?? undefined,
      channelSlug: orm.channelSlug ?? undefined,
      reservedInvoiceId: orm.reservedInvoiceId ?? undefined,
      periodId: orm.periodId ?? undefined,
      isReservation: orm.isReservation,
      relatedTransactionId: orm.relatedTransactionId ?? undefined,
      createdAt: orm.createdAt,
    });
  }

  toPersistence(domain: CreditTransaction): CreditTransactionOrmEntity {
    const orm = new CreditTransactionOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.amount = domain.amount;
    orm.type = domain.type;
    orm.description = domain.description;
    orm.stripeSessionId = domain.stripeSessionId;
    orm.metadata = domain.metadata;
    orm.amountBrlCents = domain.amountBrlCents;
    orm.unitPriceCentsApplied = domain.unitPriceCentsApplied;
    orm.planIdSnapshot = domain.planIdSnapshot;
    orm.source = domain.source;
    orm.channelSlug = domain.channelSlug;
    orm.reservedInvoiceId = domain.reservedInvoiceId;
    orm.periodId = domain.periodId;
    orm.isReservation = domain.isReservation;
    orm.relatedTransactionId = domain.relatedTransactionId;
    orm.createdAt = domain.createdAt;
    return orm;
  }
}
