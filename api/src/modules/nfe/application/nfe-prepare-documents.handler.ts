import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
  type StorageRef,
} from '@/infra/storage/domain/document-storage';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import type { DocumentRenderer } from '@/modules/fiscal-core/domain/ports/renderer.port';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import {
  NFE_PREPARE_DOCUMENTS,
  type NfePrepareDocumentsPayload,
  type NfePrepareInutilizationPayload,
} from '../domain/nfe-message-types';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import { TypeormNfeInutilizations } from '../infra/typeorm-nfe-inutilizations';
import { NFE_DANFE_RENDERER } from '../nfe.tokens';
import { DANFE_FILE, NFE_PROC_FILE } from './nfe-files';
import { sendEmailMessage } from './nfe-messages';
import { buildNfeProc } from './nfe-proc';
import { keyOf } from './nfe-outcome.service';
import { NfeTransitionService } from './nfe-transition.service';

const XML = 'application/xml';
const PDF = 'application/pdf';

/** The documents stay available after a cancellation. */
const PREPARABLE = new Set(['authorized', 'cancelling', 'cancelled']);

/**
 * `nfe.prepare_documents`: stores the `nfeProc` and the DANFE of an authorized NF-e, marks the
 * documents ready (webhook `documents_ready`, and the e-mail to the customer when asked for), and
 * stores the XML of the events the SEFAZ registered and of the inutilizations it approved. A
 * cancellation redoes the DANFE with the CANCELADA mark.
 *
 * Safe to run again: the files are the same bytes, the "ready" mark is first-write-wins and the
 * e-mail has its own dedupe key. The XML never goes to a log.
 */
@Injectable()
export class NfePrepareDocumentsHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_PREPARE_DOCUMENTS;
  private readonly logger = new Logger(NfePrepareDocumentsHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: IDocumentStorage,
    @Inject(NFE_DANFE_RENDERER) private readonly danfe: DocumentRenderer,
    private readonly events: TypeormNfeEvents,
    private readonly inutilizations: TypeormNfeInutilizations,
    private readonly transitions: NfeTransitionService,
    private readonly webhooks: FiscalWebhookPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const payload = message.payload as Partial<
      NfePrepareDocumentsPayload & NfePrepareInutilizationPayload
    >;
    if (payload.inutilizationId)
      return this.storeInutilization(
        payload.inutilizationId,
        message.tenantId,
        message.environment,
      );
    if (!payload.documentId) throw new Error('The message has no document');
    const doc = await this.documents.findById(
      payload.documentId,
      message.tenantId,
      message.environment,
    );
    if (!doc) {
      this.logger.warn({ documentId: payload.documentId }, 'NF-e not found');
      return;
    }
    if (!PREPARABLE.has(doc.status)) {
      this.logger.debug(
        { documentId: doc.id, status: doc.status },
        'NF-e is not authorized: no documents to prepare',
      );
      return;
    }
    await this.prepare(doc);
  }

  private async prepare(doc: NfeDocument): Promise<void> {
    const s = doc.toSnapshot();
    if (!s.signedXml || !s.protNfeXml)
      throw new Error(`NF-e ${doc.id} has no authorized XML to store`);
    const ref: StorageRef = {
      type: 'nfe',
      id: doc.id,
      tenantId: doc.tenantId,
      environment: doc.environment,
    };

    if (!(await this.storage.fileExists(ref, NFE_PROC_FILE)))
      await this.storage.saveFile(
        ref,
        NFE_PROC_FILE,
        buildNfeProc(s.signedXml, s.protNfeXml),
        XML,
      );
    const cancelled = s.status === 'cancelled';
    await this.ensureDanfe(ref, doc, cancelled);
    await this.storeEvents(ref, doc);

    // A cancellation that landed while the DANFE was being drawn: draw it again, with the mark.
    if (!cancelled) {
      const now = await this.documents.findById(
        doc.id,
        doc.tenantId,
        doc.environment,
      );
      if (now?.status === 'cancelled') await this.ensureDanfe(ref, now, true);
    }
    if (!s.documentsReadyAt) await this.markReady(doc);
  }

  /** Draws the DANFE when there is none yet, or again when the NF-e is cancelled (the mark). */
  private async ensureDanfe(
    ref: StorageRef,
    doc: NfeDocument,
    cancelled: boolean,
  ): Promise<void> {
    if (!cancelled && (await this.storage.fileExists(ref, DANFE_FILE))) return;
    const s = doc.toSnapshot();
    const xml = buildNfeProc(s.signedXml!, s.protNfeXml!);
    const pdf = await this.danfe.render(xml, {
      homologation: doc.environment === 'test',
      cancelled,
    });
    await this.storage.saveFile(ref, DANFE_FILE, pdf, PDF);
  }

  /** The XML of each registered event (cancellation, correction letter) goes to its own file. */
  private async storeEvents(ref: StorageRef, doc: NfeDocument): Promise<void> {
    for (const event of await this.events.list(doc.id, doc.tenantId)) {
      if (event.status !== 'registered' || !event.procXml || event.xmlPath)
        continue;
      const path = await this.storage.saveFile(
        ref,
        `events/${event.tpEvento}-${event.nSeq}.xml`,
        event.procXml,
        XML,
      );
      await this.events.markStored(event.id, doc.tenantId, path);
    }
  }

  private async storeInutilization(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<void> {
    const inut = await this.inutilizations.find(id, tenantId);
    if (!inut || inut.status !== 'homologada' || !inut.procXml || inut.xmlPath)
      return;
    const path = await this.storage.saveFile(
      { type: 'nfe-inutilization', id, tenantId, environment },
      'proc.xml',
      inut.procXml,
      XML,
    );
    await this.inutilizations.markStored(id, tenantId, path);
  }

  /** First write wins: only the worker that marks it publishes the webhook and queues the e-mail. */
  private async markReady(doc: NfeDocument): Promise<void> {
    const s = doc.toSnapshot();
    const emailWanted =
      s.status === 'authorized' && s.sendEmail && Boolean(s.recipient.email);
    let won = false;
    const stored = await this.transitions.touch(keyOf(doc), {
      change: (locked) => {
        won = locked.markDocumentsReady();
        if (won && emailWanted) locked.recordEmail('queued');
      },
      // Same transaction as the mark; the dedupe key keeps a second worker from queueing it again.
      messages: emailWanted ? [sendEmailMessage(doc)] : [],
    });
    if (!won) return;
    const ready = stored.toSnapshot();
    await this.webhooks.publish(
      {
        type: 'nfe',
        id: ready.id,
        tenantId: ready.tenantId,
        environment: ready.environment,
        companyId: ready.companyId,
      },
      'nfe.document.documents_ready',
      {
        status: ready.status,
        accessKey: ready.accessKey,
        number: ready.number,
        series: ready.series,
        protocol: ready.protocol,
        externalId: ready.externalId,
        documentsReadyAt: ready.documentsReadyAt?.toISOString() ?? null,
        emailRequested: emailWanted,
      },
    );
    this.logger.log(
      { documentId: ready.id, accessKey: ready.accessKey },
      'NF-e documents are ready',
    );
  }
}
