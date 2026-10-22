import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  Invoice,
  InvoiceProps,
  LastEmailStatus,
  ServiceSnapshot,
} from '../domain/invoice';
import type { CancellationReasonCode } from '../domain/cancellation-reason';
import { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceOrmEntity } from './invoice.orm-entity';

type PersistedServiceSnapshot = ServiceSnapshot & { discount?: number };

function normalizeCustomerSnapshot(
  value: Record<string, unknown> | null | undefined,
): InvoiceProps['customerSnapshot'] {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }
  return value as unknown as InvoiceProps['customerSnapshot'];
}

function readServiceSnapshot(
  value: Record<string, unknown> | null | undefined,
): {
  snapshot: ServiceSnapshot;
  discount?: number;
} {
  const { discount, ...rest } = (value ??
    {}) as unknown as PersistedServiceSnapshot;
  return { snapshot: rest, discount };
}

export class InvoiceMapper {
  toDomain(orm: InvoiceOrmEntity): Invoice {
    const props: InvoiceProps = {
      id: orm.id,
      companyId: orm.companyId,
      tenantId: orm.tenantId,
      environment: orm.environment as ExecutionEnvironment,
      requestHash: orm.requestHash,
      documentKeyVersion: orm.documentKeyVersion,
      emailSnapshot: orm.emailSnapshot,
      externalId: orm.externalId ?? null,
      idempotencyKey: orm.idempotencyKey ?? null,
      status: orm.status as InvoiceStatus,
      // `customer_snapshot` is NOT NULL — anonymous consumer invoices are
      // persisted as `{}` and read back as `null`.
      customerSnapshot: normalizeCustomerSnapshot(orm.customerSnapshot),
      serviceSnapshot: readServiceSnapshot(orm.serviceSnapshot).snapshot,
      discount: readServiceSnapshot(orm.serviceSnapshot).discount,
      taxSnapshot: orm.taxSnapshot,
      amount: Number(orm.amount),
      currency: orm.currency,
      competenceDate: new Date(orm.competenceDate),
      scheduledFor: orm.scheduledFor ?? null,
      dpsId: orm.dpsId ?? null,
      dpsSeries: orm.dpsSeries ?? null,
      dpsNumber: orm.dpsNumber ? Number(orm.dpsNumber) : null,
      accessKey: orm.accessKey ?? null,
      nfseNumber: orm.nfseNumber ? Number(orm.nfseNumber) : null,
      fiscalProvider: orm.fiscalProvider,
      fiscalSchemaVersion: orm.fiscalSchemaVersion,
      issuedAt: orm.issuedAt ?? null,
      authorizedAt: orm.authorizedAt ?? null,
      lastErrorCode: orm.lastErrorCode ?? null,
      lastErrorMessage: orm.lastErrorMessage ?? null,
      lastErrorProvider: orm.lastErrorProvider ?? null,
      documentsReadyAt: orm.documentsReadyAt ?? null,
      lastEmailStatus: (orm.lastEmailStatus as LastEmailStatus | null) ?? null,
      lastEmailSentAt: orm.lastEmailSentAt ?? null,
      cancellationReason:
        (orm.cancellationReason as CancellationReasonCode | null) ?? null,
      cancellationDescription: orm.cancellationDescription ?? null,
      cancelledAt: orm.cancelledAt ?? null,
      cancellationRequestedAt: orm.cancellationRequestedAt ?? null,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    };
    return Invoice.reconstitute(props);
  }

  toPersistence(domain: Invoice): InvoiceOrmEntity {
    const orm = new InvoiceOrmEntity();
    const snapshot = domain.toSnapshot();
    orm.id = snapshot.id;
    orm.companyId = snapshot.companyId;
    orm.tenantId = snapshot.tenantId;
    orm.environment = domain.environment;
    orm.documentKeyVersion = snapshot.documentKeyVersion ?? 2;
    orm.requestHash = snapshot.requestHash ?? undefined;
    orm.emailSnapshot = snapshot.emailSnapshot;
    orm.externalId = snapshot.externalId ?? undefined;
    orm.idempotencyKey = snapshot.idempotencyKey ?? undefined;
    orm.status = snapshot.status;
    // `customer_snapshot` is NOT NULL — anonymous consumer invoices are
    // persisted as `{}` and read back as `null`.
    orm.customerSnapshot = (snapshot.customerSnapshot ??
      {}) as unknown as Record<string, unknown>;
    // No dedicated discount column yet: `discount` rides in the
    // `service_snapshot` jsonb and is lifted back by `readServiceSnapshot`.
    const { discount } = snapshot;
    const serviceSnapshot = snapshot.serviceSnapshot;
    orm.serviceSnapshot = {
      ...serviceSnapshot,
      ...(discount !== undefined ? { discount } : {}),
    };
    orm.taxSnapshot = snapshot.taxSnapshot;
    orm.amount = snapshot.amount;
    orm.currency = snapshot.currency;
    // PostgreSQL DATE has no timezone. A Date at UTC midnight would be
    // converted to the previous day by TypeORM in America/Sao_Paulo.
    orm.competenceDate = snapshot.competenceDate.toISOString().slice(0, 10);
    orm.scheduledFor = snapshot.scheduledFor ?? null;
    orm.dpsId = snapshot.dpsId ?? undefined;
    orm.dpsSeries = snapshot.dpsSeries ?? undefined;
    orm.dpsNumber = snapshot.dpsNumber ?? undefined;
    orm.accessKey = snapshot.accessKey ?? undefined;
    orm.nfseNumber = snapshot.nfseNumber ?? undefined;
    orm.fiscalProvider = snapshot.fiscalProvider;
    orm.fiscalSchemaVersion = snapshot.fiscalSchemaVersion;
    orm.issuedAt = snapshot.issuedAt ?? undefined;
    orm.authorizedAt = snapshot.authorizedAt ?? undefined;
    orm.lastErrorCode = snapshot.lastErrorCode ?? null;
    orm.lastErrorMessage = snapshot.lastErrorMessage ?? null;
    orm.lastErrorProvider = snapshot.lastErrorProvider ?? null;
    orm.documentsReadyAt = snapshot.documentsReadyAt ?? undefined;
    orm.lastEmailStatus = snapshot.lastEmailStatus ?? undefined;
    orm.lastEmailSentAt = snapshot.lastEmailSentAt ?? undefined;
    orm.cancellationReason = snapshot.cancellationReason ?? null;
    orm.cancellationDescription = snapshot.cancellationDescription ?? null;
    orm.cancelledAt = snapshot.cancelledAt ?? null;
    orm.cancellationRequestedAt = snapshot.cancellationRequestedAt ?? null;
    orm.createdAt = snapshot.createdAt;
    orm.updatedAt = snapshot.updatedAt;
    return orm;
  }
}
