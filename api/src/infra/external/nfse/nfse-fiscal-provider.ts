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
}

export interface FiscalProvider {
  issue(payload: IIssuePayload): Promise<FiscalIssueResult>;
  queryByAccessKey(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<FiscalQueryResult>;
  retrievePdf(
    accessKey: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<Buffer>;
}

export const FISCAL_PROVIDER = 'FISCAL_PROVIDER';
