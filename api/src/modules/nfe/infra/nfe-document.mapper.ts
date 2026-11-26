import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  NfeDocument,
  type NfeDocumentSnapshot,
  type NfeErrorType,
  type NfeHistoryEntry,
  type NfePaymentSnapshot,
  type NfeRecipient,
  type NfeTotalsSnapshot,
} from '../domain/nfe-document';
import type { NfeItem } from '../domain/nfe-item';
import type { NfeStatus } from '../domain/nfe-status';
import { NfeDocumentHistoryOrmEntity } from './nfe-document-history.orm-entity';
import { NfeDocumentItemOrmEntity } from './nfe-document-item.orm-entity';
import { NfeDocumentOrmEntity } from './nfe-document.orm-entity';

export class NfeDocumentMapper {
  toDomain(row: NfeDocumentOrmEntity, items: NfeDocumentItemOrmEntity[]) {
    return NfeDocument.reconstitute({
      id: row.id,
      tenantId: row.tenantId,
      companyId: row.companyId,
      environment: row.environment as ExecutionEnvironment,
      model: row.model === 65 ? 65 : 55,
      series: row.series,
      number: row.number,
      accessKey: row.accessKey,
      cNf: row.cNf,
      tpEmis: row.tpEmis,
      issuedAt: row.issuedAt,
      natOp: row.natOp,
      idDest: row.idDest,
      indFinal: row.indFinal,
      indPres: row.indPres,
      finNfe: row.finNfe,
      tpImp: row.tpImp,
      status: row.status as NfeStatus,
      cStat: row.cStat,
      xMotivo: row.xMotivo,
      protocol: row.protocol,
      authorizedAt: row.authorizedAt,
      recipient: row.recipient as unknown as NfeRecipient | null,
      items: [...items]
        .sort((a, b) => a.nItem - b.nItem)
        .map((item) => this.itemToDomain(item)),
      totals: row.totals as unknown as NfeTotalsSnapshot,
      payment: row.payment as unknown as NfePaymentSnapshot,
      transport: { modFrete: 9 },
      additionalInfo: row.additionalInfo,
      externalId: row.externalId,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      signedXml: row.signedXml,
      protNfeXml: row.protNfeXml,
      attempt: row.attempt,
      authority: row.authority,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      lastErrorType: row.lastErrorType as NfeErrorType | null,
      nextCheckAt: row.nextCheckAt,
      reconcileAttempts: row.reconcileAttempts,
      sendEmail: row.sendEmail,
      documentsReadyAt: row.documentsReadyAt,
      emailStatus: row.emailStatus,
      emailSentAt: row.emailSentAt,
      cancelReason: row.cancelReason,
      cancelRequestedAt: row.cancelRequestedAt,
      qrCode: row.qrCode,
      urlChave: row.urlChave,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  toPersistence(document: NfeDocument): NfeDocumentOrmEntity {
    const s = document.toSnapshot();
    const row = new NfeDocumentOrmEntity();
    Object.assign(row, {
      id: s.id,
      tenantId: s.tenantId,
      companyId: s.companyId,
      environment: s.environment,
      model: s.model,
      series: s.series,
      number: s.number,
      accessKey: s.accessKey,
      cNf: s.cNf,
      tpEmis: s.tpEmis,
      issuedAt: s.issuedAt,
      natOp: s.natOp,
      idDest: s.idDest,
      indFinal: s.indFinal,
      indPres: s.indPres,
      finNfe: s.finNfe,
      tpImp: s.tpImp,
      status: s.status,
      cStat: s.cStat,
      xMotivo: s.xMotivo,
      protocol: s.protocol,
      authorizedAt: s.authorizedAt,
      recipient: s.recipient,
      totals: s.totals,
      payment: s.payment,
      transport: s.transport,
      additionalInfo: s.additionalInfo,
      externalId: s.externalId,
      idempotencyKey: s.idempotencyKey,
      requestHash: s.requestHash,
      signedXml: s.signedXml,
      protNfeXml: s.protNfeXml,
      attempt: s.attempt,
      authority: s.authority,
      lastErrorCode: s.lastErrorCode,
      lastErrorMessage: s.lastErrorMessage,
      lastErrorType: s.lastErrorType,
      nextCheckAt: s.nextCheckAt,
      reconcileAttempts: s.reconcileAttempts,
      sendEmail: s.sendEmail,
      documentsReadyAt: s.documentsReadyAt,
      emailStatus: s.emailStatus,
      emailSentAt: s.emailSentAt,
      cancelReason: s.cancelReason,
      cancelRequestedAt: s.cancelRequestedAt,
      qrCode: s.qrCode,
      urlChave: s.urlChave,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
    return row;
  }

  itemsToPersistence(
    snapshot: NfeDocumentSnapshot,
  ): NfeDocumentItemOrmEntity[] {
    return snapshot.items.map((item) => {
      const row = new NfeDocumentItemOrmEntity();
      Object.assign(row, {
        documentId: snapshot.id,
        nItem: item.nItem,
        tenantId: snapshot.tenantId,
        code: item.code,
        gtin: item.gtin,
        description: item.description,
        ncm: item.ncm,
        cest: item.cest,
        cfop: item.cfop,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        discount: item.discount,
        freight: item.freight,
        insurance: item.insurance,
        other: item.other,
        origin: item.tax.origin,
        csosn: item.tax.csosn,
        pisCst: item.tax.pisCst,
        cofinsCst: item.tax.cofinsCst,
        ibsCbs: item.ibsCbs,
      });
      return row;
    });
  }

  historyToPersistence(entry: NfeHistoryEntry): NfeDocumentHistoryOrmEntity {
    const row = new NfeDocumentHistoryOrmEntity();
    Object.assign(row, {
      tenantId: entry.tenantId,
      documentId: entry.documentId,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      accessKey: entry.accessKey,
      attempt: entry.attempt,
      cStat: entry.cStat,
      xMotivo: entry.xMotivo,
    });
    return row;
  }

  private itemToDomain(row: NfeDocumentItemOrmEntity): NfeItem {
    return {
      nItem: row.nItem,
      code: row.code,
      gtin: row.gtin,
      description: row.description,
      ncm: row.ncm,
      cest: row.cest,
      cfop: row.cfop,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      total: row.total,
      discount: row.discount,
      freight: row.freight,
      insurance: row.insurance,
      other: row.other,
      tax: {
        origin: row.origin,
        csosn: row.csosn,
        pisCst: row.pisCst,
        cofinsCst: row.cofinsCst,
      },
      ibsCbs: row.ibsCbs,
    };
  }
}
