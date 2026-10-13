import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { parseNfseXml, gerarDanfse, Ambiente } from 'open-nfse';
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
import { buildInvoiceState } from '../domain/invoice-state';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { NfseDocPrepJobData } from '@/infra/queues/nfse-doc-prep-job.types';
import type { NfseEmailJobData } from '@/infra/queues/nfse-email-job.types';

const LOCK_TTL_MS = 60_000;
const EMAIL_QUEUE = 'nfse-email';

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

      if (invoice.status !== 'authorized') {
        this.logger.warn(
          `Invoice ${invoiceId} status is ${invoice.status}, expected 'authorized'. Skipping doc-prep.`,
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
        const xml = await this.documentStorage.getXml(
          tenantId,
          invoiceId,
          invoice.storageEnvironment,
        );
        const nfse = parseNfseXml(xml);

        const ambiente = mapTpAmbToAmbiente(nfse.infNFSe.DPS.infDPS.tpAmb);
        const urlConsultaPublica =
          ambiente === Ambiente.ProducaoRestrita
            ? NFSE_PUBLIC_CONSULTATION_URL.restrictedProduction
            : NFSE_PUBLIC_CONSULTATION_URL.production;

        const pdfBuffer = await gerarDanfse(nfse, {
          ambiente,
          urlConsultaPublica,
          observacoes:
            invoice.environment === 'test' ? NFSE_TEST_DISCLAIMER : undefined,
        });

        await this.documentStorage.savePdf(
          tenantId,
          invoiceId,
          pdfBuffer,
          invoice.storageEnvironment,
        );
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

      // 7. Enqueue automatic email if configured
      if (invoice.emailSnapshot?.send && invoice.customerSnapshot?.email) {
        const emailData: NfseEmailJobData = {
          invoiceId,
          tenantId,
        };

        await this.queueService.add(EMAIL_QUEUE, 'deliver', emailData, {
          idempotencyKey: `email-auto-${invoiceId}`,
          attempts: 3,
          backoffMs: 5_000,
          removeOnComplete: false,
          removeOnFail: 1000,
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
          `NfseEmail job enqueued for invoice ${invoiceId} to ${invoice.customerSnapshot.email}`,
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
