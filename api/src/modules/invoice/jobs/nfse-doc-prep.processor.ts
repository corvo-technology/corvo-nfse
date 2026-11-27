import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { parseNfseXml, Ambiente } from 'open-nfse';
import { renderInvoicePdf, type DanfseOptions } from '../infra/danfse/danfse';
import { REFRESH_PDF_JOB } from '../application/invoice-pdf-refresher';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import {
  NFSE_PUBLIC_CONSULTATION_URL,
  NFSE_TEST_DISCLAIMER,
} from '@/shared/fiscal/nfse-constants';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState } from '../domain/invoice-state';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { NfseDocPrepJobData } from '@/infra/queues/nfse-doc-prep-job.types';
import type { NfseEmailJobData } from '@/infra/queues/nfse-email-job.types';

const LOCK_TTL_MS = 60_000;
const EMAIL_QUEUE = 'nfse-email';
const DOC_PREP_STATUSES: ReadonlyArray<Invoice['status']> = [
  'authorized',
  'cancelling',
  'cancelled',
];

@Processor('nfse-doc-prep')
@Injectable()
export class NfseDocPrepProcessor extends WorkerHost {
  private readonly logger = new Logger(NfseDocPrepProcessor.name);

  constructor(
    @Inject(LOCK_PORT) private readonly lockService: LockPort,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly queueService: BullmqQueueService,
    private readonly webhookConfigRepo: IWebhookConfigRepository,
    private readonly outboxService: WebhookOutboxService,
  ) {
    super();
  }

  async process(job: Job<NfseDocPrepJobData>): Promise<void> {
    if (job.name === REFRESH_PDF_JOB) return this.refreshPdf(job.data);
    const { invoiceId, tenantId, companyId } = job.data;
    const lockKey = `nfse:doc-prep:${invoiceId}`;

    const lock = await this.lockService.acquire(lockKey, {
      ttlMs: LOCK_TTL_MS,
    });
    if (!lock) {
      this.logger.warn(
        `Could not acquire lock for doc-prep ${invoiceId}, skipping`,
      );
      return;
    }

    try {
      const invoice = await this.invoiceRepo.findByIdAndTenantId(
        invoiceId,
        tenantId,
      );
      if (!invoice) {
        this.logger.error(`Invoice ${invoiceId} not found`);
        return;
      }

      // Documents stay available after cancellation (wasAuthorized), so
      // cancelling/cancelled invoices also get their PDF generated.
      if (!DOC_PREP_STATUSES.includes(invoice.status)) {
        this.logger.warn(
          `Invoice ${invoiceId} status is ${invoice.status}, expected authorized/cancelling/cancelled. Skipping doc-prep.`,
        );
        return;
      }

      if (
        invoice.documentsReadyAt &&
        !(invoice.emailSnapshot?.send && !invoice.lastEmailStatus)
      ) {
        this.logger.debug(
          `Documents already ready for invoice ${invoiceId}, skipping.`,
        );
        return;
      }

      // 4. Generate PDF if not already stored
      if (
        !(await this.documentStorage.exists(
          tenantId,
          invoiceId,
          'pdf',
          invoice.storageEnvironment,
        ))
      ) {
        await this.renderAndSavePdf(invoice);
        this.logger.debug(`PDF generated and saved for invoice ${invoiceId}`);
      }

      // 5. Mark documents ready (first-write-wins)
      const won = await this.invoiceRepo.markDocumentsReady(
        invoiceId,
        tenantId,
        new Date(),
      );

      if (!won && !(invoice.emailSnapshot?.send && !invoice.lastEmailStatus)) {
        this.logger.debug(
          `Documents already marked ready by another worker for invoice ${invoiceId}, skipping post-actions.`,
        );
        return;
      }

      // 6. Emit webhook
      if (won)
        await this.emitWebhook(
          tenantId,
          'nfse.invoice.documents_ready',
          {
            invoiceId,
            accessKey: invoice.accessKey,
            nfseNumber: invoice.nfseNumber,
            companyId,
            ...buildInvoiceState({
              status: invoice.status,
              documentsReady: true,
              emailRequested: Boolean(invoice.emailSnapshot?.send),
              emailStatus: invoice.lastEmailStatus,
            }),
            documentsReadyAt: new Date().toISOString(),
          },
          invoice.environment,
        );

      // 7. Enqueue automatic email if configured (never after cancellation)
      const customerEmail = invoice.customerSnapshot?.email;
      if (
        invoice.status === 'authorized' &&
        invoice.emailSnapshot?.send &&
        customerEmail
      ) {
        const emailData: NfseEmailJobData = {
          invoiceId,
          tenantId,
        };

        await this.queueService.add(EMAIL_QUEUE, 'deliver', emailData, {
          idempotencyKey: `email-auto-${invoiceId}`,
          attempts: 3,
          backoffMs: 5_000,
          ...QUEUE_RETENTION['nfse-email'],
        });

        // A fast email worker may already have marked delivery as sent.
        await this.invoiceRepo.updateEmailStatus(
          invoiceId,
          tenantId,
          'queued',
          undefined,
          true,
        );
        this.logger.debug(
          `NfseEmail job enqueued for invoice ${invoiceId} to ${customerEmail}`,
        );
      }

      this.logger.log(`Documents prepared for invoice ${invoiceId}`);
    } catch (e: unknown) {
      this.logger.error({ err: e, invoiceId }, 'nfse-doc-prep failed');
      throw e;
    } finally {
      await this.lockService.release(lock);
    }
  }

  /**
   * Redoes the stored PDF of a cancelled invoice with its CANCELADA / SUBSTITUÍDA watermark.
   * Safe to repeat (same input, same file, overwritten). It never creates a PDF that was not
   * there: doc-prep does that, and it already draws the mark for a cancelled invoice.
   */
  private async refreshPdf(data: NfseDocPrepJobData): Promise<void> {
    const { invoiceId, tenantId } = data;
    const lock = await this.lockService.acquire(`nfse:doc-prep:${invoiceId}`, {
      ttlMs: LOCK_TTL_MS,
    });
    if (!lock) {
      // Throwing hands the job back to the queue's retries.
      throw new Error(
        `PDF refresh of ${invoiceId} is locked by another worker`,
      );
    }
    try {
      const invoice = await this.invoiceRepo.findByIdAndTenantId(
        invoiceId,
        tenantId,
      );
      if (!invoice || invoice.status !== 'cancelled' || !invoice.wasAuthorized)
        return;
      if (
        !(await this.documentStorage.exists(
          tenantId,
          invoiceId,
          'pdf',
          invoice.storageEnvironment,
        ))
      ) {
        // Documents are still being prepared: retry once the PDF exists. Once they were
        // ready and there is no PDF, this invoice never had one: nothing to mark.
        if (!invoice.documentsReadyAt)
          throw new Error(`PDF of ${invoiceId} is still being prepared`);
        return;
      }
      await this.renderAndSavePdf(invoice);
      this.logger.log(`PDF of cancelled invoice ${invoiceId} marked`);
    } catch (e: unknown) {
      this.logger.error({ err: e, invoiceId }, 'nfse-pdf refresh failed');
      throw e;
    } finally {
      await this.lockService.release(lock);
    }
  }

  private async renderAndSavePdf(invoice: Invoice): Promise<void> {
    const xml = await this.documentStorage.getXml(
      invoice.tenantId,
      invoice.id,
      invoice.storageEnvironment,
    );
    const nfse = parseNfseXml(xml);

    const ambiente = mapTpAmbToAmbiente(nfse.infNFSe.DPS.infDPS.tpAmb);
    const urlConsultaPublica =
      ambiente === Ambiente.ProducaoRestrita
        ? NFSE_PUBLIC_CONSULTATION_URL.restrictedProduction
        : NFSE_PUBLIC_CONSULTATION_URL.production;

    const isTest = invoice.environment === 'test';
    const status = await this.watermarkOf(invoice);
    const pdfBuffer = await renderInvoicePdf(
      nfse,
      {
        ambiente,
        urlConsultaPublica,
        observacoes: isTest ? NFSE_TEST_DISCLAIMER : undefined,
      },
      { notes: isTest ? [NFSE_TEST_DISCLAIMER] : [], status },
    );
    await this.documentStorage.savePdf(
      invoice.tenantId,
      invoice.id,
      pdfBuffer,
      invoice.storageEnvironment,
    );
  }

  /** The mark of a cancelled invoice: SUBSTITUÍDA when a substitute replaced it, else CANCELADA. */
  private async watermarkOf(
    invoice: Invoice,
  ): Promise<DanfseOptions['status']> {
    if (invoice.status !== 'cancelled') return undefined;
    return (await this.invoiceRepo.hasSubstitute(invoice.id, invoice.tenantId))
      ? 'replaced'
      : 'cancelled';
  }

  private async emitWebhook(
    tenantId: string,
    eventType: string,
    data: Record<string, unknown>,
    environment: 'live' | 'test' = 'live',
  ): Promise<void> {
    try {
      const configs = await this.webhookConfigRepo.findByTenantIdAndEvent(
        tenantId,
        eventType,
        environment,
      );

      for (const config of configs) {
        if (!config.active) continue;

        const event: WebhookEvent = {
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          type: eventType as WebhookEvent['type'],
          environment,
          createdAt: new Date().toISOString(),
          data,
        };

        await this.outboxService.enqueue({
          tenantId,
          webhookConfigId: config.id,
          eventType,
          environment,
          url: config.url,
          payload: event,
          secret: config.secret,
        });

        this.logger.debug(
          `Webhook ${eventType} enqueued for tenant ${tenantId}`,
        );
      }
    } catch (e: unknown) {
      this.logger.error(
        `Failed to emit webhook ${eventType}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Maps DPS tpAmb (1 = Producao, 2 = Homologacao/ProducaoRestrita) to Ambiente enum. */
function mapTpAmbToAmbiente(tpAmb: string | undefined): Ambiente {
  if (tpAmb === '2') return Ambiente.ProducaoRestrita;
  return Ambiente.Producao;
}
