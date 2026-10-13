import { InvoiceEvent, InvoiceEventSnapshot } from '../domain/invoice-event';
import { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceEventOrmEntity } from './invoice-event.orm-entity';

export class InvoiceEventMapper {
  toDomain(orm: InvoiceEventOrmEntity): InvoiceEvent {
    const snapshot: InvoiceEventSnapshot = {
      id: orm.id,
      invoiceId: orm.invoiceId,
      fromStatus: (orm.fromStatus as InvoiceStatus) ?? null,
      toStatus: orm.toStatus as InvoiceStatus,
      reason: orm.reason ?? null,
      createdAt: orm.createdAt,
    };
    // Reconstitute by creating a new instance with the same snapshot
    return InvoiceEvent.create(
      snapshot.invoiceId,
      snapshot.fromStatus,
      snapshot.toStatus,
      snapshot.reason ?? undefined,
    );
  }

  toPersistence(domain: InvoiceEvent): InvoiceEventOrmEntity {
    const orm = new InvoiceEventOrmEntity();
    const snapshot = domain.toSnapshot();
    orm.id = snapshot.id;
    orm.invoiceId = snapshot.invoiceId;
    orm.fromStatus = snapshot.fromStatus ?? undefined;
    orm.toStatus = snapshot.toStatus;
    orm.reason = snapshot.reason ?? undefined;
    orm.createdAt = snapshot.createdAt;
    return orm;
  }
}
