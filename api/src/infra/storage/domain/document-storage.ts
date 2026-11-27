import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { DocumentRef } from '@/modules/fiscal-core/domain/document-type';
export type DocumentFormat = 'pdf' | 'xml';

export interface SignedDocumentUrl {
  url: string;
  expiresAt: Date;
  fileName: string;
  mimeType: string;
}

/**
 * Where a stored file belongs: a fiscal document, or (NF-e only) an inutilization, which is not a
 * document of its own but needs its own folder.
 */
export type StorageRef =
  DocumentRef | (Omit<DocumentRef, 'type'> & { type: 'nfe-inutilization' });

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

  /**
   * Files of the documents that are not NFS-e, by reference. NF-e: `{tenant}/{env}/nfe/{id}/{fileName}`;
   * an inutilization: `{tenant}/{env}/nfe-inutilizacoes/{id}.xml` (its `fileName` is only checked).
   * Returns the key.
   */
  saveFile(
    ref: StorageRef,
    fileName: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<string>;
  getFile(ref: StorageRef, fileName: string): Promise<Buffer>;
  fileExists(ref: StorageRef, fileName: string): Promise<boolean>;
  getFileSignedUrl(
    ref: StorageRef,
    fileName: string,
    options: { downloadName: string; expiresInSeconds?: number },
  ): Promise<SignedDocumentUrl>;
}

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

/** The S3 client shared by every storage in the app (documents, import files). */
export const S3_CLIENT = Symbol('S3_CLIENT');
