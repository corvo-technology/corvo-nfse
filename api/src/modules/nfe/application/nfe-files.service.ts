import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
  type SignedDocumentUrl,
  type StorageRef,
} from '@/infra/storage/domain/document-storage';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import {
  nfeDocumentsNotReady,
  nfeDownloadFormatInvalid,
  nfeNotFound,
} from './nfe-errors';
import { DANFE_FILE, NFE_PROC_FILE } from './nfe-files';

export type NfeFileFormat = 'xml' | 'pdf';

const STORED: Record<NfeFileFormat, string> = {
  xml: NFE_PROC_FILE,
  pdf: DANFE_FILE,
};

/** Seconds a download link lives (same as the NFS-e one). */
const URL_TTL_SECONDS = 3600;

/**
 * The files of an NF-e (`nfeProc` and DANFE) for the routes `/v1/invoices/{id}/xml`, `/pdf` and
 * `/download-url`. They stay available after a cancellation; before they are stored (or for an NF-e
 * that never got authorized) the answer is 409 `DOCUMENTS_NOT_READY`.
 */
@Injectable()
export class NfeFilesService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: IDocumentStorage,
  ) {}

  private async ready(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<{ doc: NfeDocument; ref: StorageRef }> {
    const doc = await this.documents.findById(id, tenantId, environment);
    if (!doc) throw nfeNotFound();
    if (!doc.toSnapshot().documentsReadyAt) throw nfeDocumentsNotReady();
    return {
      doc,
      ref: { type: 'nfe', id: doc.id, tenantId, environment },
    };
  }

  private fileName(doc: NfeDocument, format: NfeFileFormat): string {
    const s = doc.toSnapshot();
    return `${s.model === 65 ? 'nfce' : 'nfe'}-${s.number ?? doc.id}.${format}`;
  }

  /** The DANFCE (the NFC-e PDF) arrives in NFC-e 4/5: until then a NFC-e has its XML only. */
  private assertFormat(doc: NfeDocument, format: NfeFileFormat): void {
    if (format === 'pdf' && doc.toSnapshot().model === 65)
      throw nfeDocumentsNotReady();
  }

  async read(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    format: NfeFileFormat,
  ): Promise<{ body: Buffer; fileName: string }> {
    const { doc, ref } = await this.ready(id, tenantId, environment);
    this.assertFormat(doc, format);
    return {
      body: await this.storage.getFile(ref, STORED[format]),
      fileName: this.fileName(doc, format),
    };
  }

  async downloadUrl(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    format: NfeFileFormat,
  ): Promise<SignedDocumentUrl> {
    // The HTTP pipe validates the body; this keeps a bad format from reaching the storage.
    if (!Object.hasOwn(STORED, format)) throw nfeDownloadFormatInvalid();
    const { doc, ref } = await this.ready(id, tenantId, environment);
    this.assertFormat(doc, format);
    return this.storage.getFileSignedUrl(ref, STORED[format], {
      downloadName: this.fileName(doc, format),
      expiresInSeconds: URL_TTL_SECONDS,
    });
  }
}
