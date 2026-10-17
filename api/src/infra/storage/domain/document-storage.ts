import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
export type DocumentFormat = 'pdf' | 'xml';

export interface SignedDocumentUrl {
  url: string;
  expiresAt: Date;
  fileName: string;
  mimeType: string;
}

export interface IDocumentStorage {
  saveXml(
    tenantId: string,
    invoiceId: string,
    xml: string,
    environment?: ExecutionEnvironment,
  ): Promise<string>;
  getXml(
    tenantId: string,
    invoiceId: string,
    environment?: ExecutionEnvironment,
  ): Promise<string>;
  savePdf(
    tenantId: string,
    invoiceId: string,
    pdf: Buffer,
    environment?: ExecutionEnvironment,
  ): Promise<string>;
  getPdf(
    tenantId: string,
    invoiceId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Buffer>;
  exists(
    tenantId: string,
    invoiceId: string,
    format: DocumentFormat,
    environment?: ExecutionEnvironment,
  ): Promise<boolean>;
  getSignedUrl(
    tenantId: string,
    invoiceId: string,
    format: DocumentFormat,
    options: { fileName: string; expiresInSeconds?: number },
    environment?: ExecutionEnvironment,
  ): Promise<SignedDocumentUrl>;
}

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');
