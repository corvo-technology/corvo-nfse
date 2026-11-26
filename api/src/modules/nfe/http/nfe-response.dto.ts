import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';
import type { NfeDocument } from '../domain/nfe-document';
import { NFE_STATUSES, type NfeStatus } from '../domain/nfe-status';
import { toNfeHttpError, type NfeHttpError } from './nfe-error-http';

export class ListNfeQuery extends CursorQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this company.' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ enum: NFE_STATUSES, description: 'Only this state.' })
  @IsOptional()
  @IsIn(NFE_STATUSES)
  status?: NfeStatus;
}

/** `POST /v1/invoices` (`type: nfe`) and `PUT /v1/invoices/{id}`: the id to follow and where the note is now. */
export interface NfeAcceptedResponse {
  id: string;
  status: NfeStatus;
  replayed?: true;
}

/**
 * The NF-e as the API shows it. The signed XML and the protocol XML are not here (they are files:
 * a later PR serves them); neither is any log of the SEFAZ answer.
 */
export function toNfeResponse(doc: NfeDocument) {
  const s = doc.toSnapshot();
  const error = toNfeHttpError(s);
  const lastError: NfeHttpError | null = error ? error.error : null;
  return {
    type: s.model === 65 ? ('nfce' as const) : ('nfe' as const),
    id: s.id,
    companyId: s.companyId,
    environment: s.environment,
    model: s.model,
    status: s.status,
    series: s.series,
    number: s.number,
    accessKey: s.accessKey,
    issuedAt: s.issuedAt,
    authorizedAt: s.authorizedAt,
    protocol: s.protocol,
    cStat: s.cStat,
    xMotivo: s.xMotivo,
    cancelReason: s.cancelReason,
    cancelRequestedAt: s.cancelRequestedAt,
    natOp: s.natOp,
    recipient: s.recipient,
    items: s.items.map((item) => ({
      nItem: item.nItem,
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
      tax: item.tax,
    })),
    totals: s.totals,
    payment: s.payment,
    additionalInfo: s.additionalInfo,
    externalId: s.externalId,
    documentsReady: s.documentsReadyAt !== null,
    documentsReadyAt: s.documentsReadyAt,
    emailStatus: s.emailStatus,
    emailSentAt: s.emailSentAt,
    attempt: s.attempt,
    lastError,
    nextCheckAt: s.nextCheckAt,
    // NFC-e only (`infNFeSupl`); the NF-e answer has no such fields.
    ...(s.model === 65 ? { qrCode: s.qrCode, urlChave: s.urlChave } : {}),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export type NfeResponse = ReturnType<typeof toNfeResponse>;
