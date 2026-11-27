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
import { NFCE_DANFCE_RENDERER } from '../nfe.tokens';
import type { DocumentRenderer } from '@/modules/fiscal-core/domain/ports/renderer.port';
import {
  nfeDocumentsNotReady,
  nfeDownloadFormatInvalid,
  nfeNotFound,
} from './nfe-errors';
import { DANFCE_FILE, DANFE_FILE, NFE_PROC_FILE } from './nfe-files';

export type NfeFileFormat = 'xml' | 'pdf';

/** Paper of the DANFCE: the 80 mm cupom (stored) or the A4 sheet (drawn when asked for). */
export interface NfePdfOptions {
  layout?: 'a4' | '80mm';
}

const storedName = (doc: NfeDocument, format: NfeFileFormat): string =>
  format === 'xml'
    ? NFE_PROC_FILE
    : doc.toSnapshot().model === 65
      ? DANFCE_FILE
      : DANFE_FILE;

/**
 * While an off-line NFC-e (`tpEmis` 9) waits for its authorization it is already with the consumer:
 * its files come from the signed XML on the document, with no protocol yet. Once the SEFAZ
 * authorizes it, the documents are prepared as for any note and these rules no longer apply.
 */
const OFFLINE_BEFORE_PROOF = new Set([
  'contingency_pending',
  'processing',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
]);

const isOfflineBeforeProof = (doc: NfeDocument): boolean => {
  const s = doc.toSnapshot();
  return (
    s.tpEmis === 9 &&
    s.documentsReadyAt === null &&
    s.signedXml !== null &&
    OFFLINE_BEFORE_PROOF.has(s.status)
  );
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
    @Inject(NFCE_DANFCE_RENDERER) private readonly danfce: DocumentRenderer,
  ) {}

  private async ready(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<{ doc: NfeDocument; ref: StorageRef }> {
    const doc = await this.documents.findById(id, tenantId, environment);
    if (!doc) throw nfeNotFound();
    if (!doc.toSnapshot().documentsReadyAt && !isOfflineBeforeProof(doc))
      throw nfeDocumentsNotReady();
    return {
      doc,
      ref: { type: 'nfe', id: doc.id, tenantId, environment },
    };
  }

  private fileName(doc: NfeDocument, format: NfeFileFormat): string {
    const s = doc.toSnapshot();
    return `${s.model === 65 ? 'nfce' : 'nfe'}-${s.number ?? doc.id}.${format}`;
  }

  /** The DANFCE drawn from the stored `nfeProc` (the A4 sheet, or a cupom that was never stored). */
  private async drawDanfce(
    doc: NfeDocument,
    ref: StorageRef,
    layout: 'a4' | '80mm',
  ): Promise<Buffer> {
    const xml = (await this.storage.getFile(ref, NFE_PROC_FILE)).toString(
      'utf8',
    );
    return this.danfce.render(xml, {
      homologation: doc.environment === 'test',
      cancelled: doc.toSnapshot().status === 'cancelled',
      layout,
    });
  }

  async read(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    format: NfeFileFormat,
    options: NfePdfOptions = {},
  ): Promise<{ body: Buffer; fileName: string }> {
    const { doc, ref } = await this.ready(id, tenantId, environment);
    if (isOfflineBeforeProof(doc))
      return this.offlineFile(doc, format, options);
    const name = storedName(doc, format);
    const isNfcePdf = format === 'pdf' && doc.toSnapshot().model === 65;
    // The A4 sheet is never stored; a cupom authorized before the DANFCE existed is drawn on demand.
    const body =
      isNfcePdf &&
      (options.layout === 'a4' || !(await this.storage.fileExists(ref, name)))
        ? await this.drawDanfce(doc, ref, options.layout ?? '80mm')
        : await this.storage.getFile(ref, name);
    return { body, fileName: this.fileName(doc, format) };
  }

  /** The signed XML, or the DANFCE drawn from it ("EMITIDA EM CONTINGÊNCIA"), straight from the document. */
  private async offlineFile(
    doc: NfeDocument,
    format: NfeFileFormat,
    options: NfePdfOptions = {},
  ): Promise<{ body: Buffer; fileName: string }> {
    const xml = doc.toSnapshot().signedXml as string;
    const body =
      format === 'xml'
        ? Buffer.from(xml, 'utf8')
        : await this.danfce.render(xml, {
            homologation: doc.environment === 'test',
            layout: options.layout ?? '80mm',
          });
    return { body, fileName: this.fileName(doc, format) };
  }

  async downloadUrl(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    format: NfeFileFormat,
  ): Promise<SignedDocumentUrl> {
    // The HTTP pipe validates the body; this keeps a bad format from reaching the storage.
    if (format !== 'xml' && format !== 'pdf') throw nfeDownloadFormatInvalid();
    const { doc, ref } = await this.ready(id, tenantId, environment);
    const name = storedName(doc, format);
    // Stored now so a link can point at it; the authorization overwrites both with the final files.
    if (isOfflineBeforeProof(doc)) {
      const file = await this.offlineFile(doc, format);
      await this.storage.saveFile(
        ref,
        name,
        file.body,
        format === 'xml' ? 'application/xml' : 'application/pdf',
      );
    } else if (
      format === 'pdf' &&
      doc.toSnapshot().model === 65 &&
      !(await this.storage.fileExists(ref, name))
    )
      await this.storage.saveFile(
        ref,
        name,
        await this.drawDanfce(doc, ref, '80mm'),
        'application/pdf',
      );
    return this.storage.getFileSignedUrl(ref, name, {
      downloadName: this.fileName(doc, format),
      expiresInSeconds: URL_TTL_SECONDS,
    });
  }
}
