import type { DPS } from 'open-nfse';

export interface FiscalIssueResult {
  success: boolean;
  accessKey?: string;
  nfseNumber?: number;
  xmlAuthorized?: string;
  pdfBuffer?: Buffer;
  errorCode?: string;
  errorMessage?: string;
  requiresReconciliation: boolean;
}

export interface FiscalQueryResult {
  accessKey?: string;
  nfseNumber?: number;
  status: 'authorized' | 'rejected' | 'pending' | 'not_found';
  xmlAuthorized?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface IIssuePayload {
  invoiceId?: string;
  tenantId?: string;
  number?: number;
  competenceDate?: Date;
  issuedAt?: Date;
  pfxBuffer: Buffer;
  p12Password: string;
  environment: 'test' | 'live';
  // Build IIssueParams from invoice/company here
  emitente: {
    cnpj: string;
    legalName?: string;
    municipalReg?: string;
    codMunicipio: string;
    regime: { opSimpNac: number; regApTribSN: number; regEspTrib: number };
  };
  serie: string;
  servico: {
    cTribNac: string;
    cNBS?: string;
    descricao: string;
    codMunicipioPrestacao?: string;
  };
  valores: { vServ: number; aliqIss?: number; pTotTribSN?: number };
  /** Absent for anonymous consumer invoices (tomador omitted from the DPS). */
  tomador?: { documento: { CNPJ: string } | { CPF: string }; nome: string };
  /** Typed DPS built from the fiscal snapshot; absent when the engine did not run. */
  preparedDps?: DPS;
}

export type FiscalCancellationReason =
  'issue_error' | 'service_not_provided' | 'other';

export interface ICancelPayload {
  invoiceId: string;
  tenantId: string;
  accessKey: string;
  environment: 'test' | 'live';
  pfxBuffer: Buffer;
  p12Password: string;
  emitenteCnpj: string;
  reason: FiscalCancellationReason;
  description: string;
}

export type FiscalCancelResult =
  | { status: 'cancelled' }
  | { status: 'rejected'; errorCode: string; errorMessage: string }
  | { status: 'pending'; errorMessage: string };

export interface FiscalProvider {
  issue(payload: IIssuePayload): Promise<FiscalIssueResult>;
  queryByAccessKey(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<FiscalQueryResult>;
  /**
   * Asks the portal whether this DPS was ever registered. `not_found` is the only answer that
   * proves the invoice was never issued; `authorized` returns the NFS-e that already exists.
   */
  queryByDps(
    idDps: string,
    credentials: IIssuePayload,
  ): Promise<FiscalQueryResult>;
  retrievePdf(
    accessKey: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<Buffer>;
  cancel(payload: ICancelPayload): Promise<FiscalCancelResult>;
}

export const FISCAL_PROVIDER = 'FISCAL_PROVIDER';
