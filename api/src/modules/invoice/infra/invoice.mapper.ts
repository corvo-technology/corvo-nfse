import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Invoice, InvoiceProps, LastEmailStatus } from '../domain/invoice';
import { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceOrmEntity } from './invoice.orm-entity';

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
      customerSnapshot:
        orm.customerSnapshot as unknown as InvoiceProps['customerSnapshot'],
      serviceSnapshot:
        orm.serviceSnapshot as unknown as InvoiceProps['serviceSnapshot'],
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
    orm.customerSnapshot = snapshot.customerSnapshot as unknown as Record<
      string,
      unknown
    >;
    orm.serviceSnapshot = snapshot.serviceSnapshot as unknown as Record<
      string,
      unknown
    >;
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
    orm.lastErrorCode = snapshot.lastErrorCode ?? undefined;
    orm.lastErrorMessage = snapshot.lastErrorMessage ?? undefined;
    orm.lastErrorProvider = snapshot.lastErrorProvider ?? undefined;
    orm.documentsReadyAt = snapshot.documentsReadyAt ?? undefined;
    orm.lastEmailStatus = snapshot.lastEmailStatus ?? undefined;
    orm.lastEmailSentAt = snapshot.lastEmailSentAt ?? undefined;
    orm.createdAt = snapshot.createdAt;
    orm.updatedAt = snapshot.updatedAt;
    return orm;
  }
}
