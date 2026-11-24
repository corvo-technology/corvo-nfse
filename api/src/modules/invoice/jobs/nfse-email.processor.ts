import { NfseWorkflowService } from '../application/nfse-workflow.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
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
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { formatBrl } from '@/shared/utils/currency';
import { nfseDocumentsReadyEmail } from '@/infra/external/email/email-templates';
import {
  MillionSendEmailProvider,
  PermanentEmailError,
} from '@/infra/external/email/mmsend-email.provider';
import type { NfseEmailJobData } from '@/infra/queues/nfse-email-job.types';

const LOCK_TTL_MS = 30_000;

function formatDateBr(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

@Processor('nfse-email')
@Injectable()
export class NfseEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NfseEmailProcessor.name);

  constructor(
    @Inject(LOCK_PORT) private readonly lockService: LockPort,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly companyRepo: ICompanyRepository,
    private readonly emailProvider: MillionSendEmailProvider,
    private readonly configService: ConfigService,
    private readonly workflow: NfseWorkflowService,
  ) {
    super();
  }

  async process(job: Job<NfseEmailJobData>): Promise<void> {
    const { invoiceId, tenantId, toEmail } = job.data;
    const lockKey = `nfse:email:${invoiceId}`;

    const lock = await this.lockService.acquire(lockKey, {
      ttlMs: LOCK_TTL_MS,
    });
    if (!lock) {
      this.logger.warn(
        `Could not acquire lock for nfse-email ${invoiceId}, skipping`,
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

      if (invoice.status === 'cancelling' || invoice.status === 'cancelled') {
        // No e-mail for a cancelled/cancelling invoice. If the cancellation is
        // rejected and the invoice returns to `authorized`, the recovery
        // scheduler re-enqueues the e-mail (authorized + requested + no status).
        this.logger.debug(
          `Invoice ${invoiceId} is ${invoice.status}, skipping e-mail`,
        );
        return;
      }

      if (invoice.status !== 'authorized' || !invoice.documentsReadyAt)
        throw new Error('Invoice documents are not ready');
      const snapshot = invoice.toSnapshot();
      const customerEmail =
        typeof toEmail === 'string' && toEmail
          ? toEmail
          : snapshot.customerSnapshot?.email;

      if (!customerEmail) {
        this.logger.warn(
          `Invoice ${invoiceId} has no customer email, marking as failed`,
        );
        await this.invoiceRepo.updateEmailStatus(invoiceId, tenantId, 'failed');
        return;
      }

      const pdfBuffer = await this.documentStorage.getPdf(
        tenantId,
        invoiceId,
        invoice.storageEnvironment,
      );
      const xmlString = await this.documentStorage.getXml(
        tenantId,
        invoiceId,
        invoice.storageEnvironment,
      );

      const nfseNumber = invoice.nfseNumber ?? 0;
      const company = await this.companyRepo.findByIdAndTenantId(
        snapshot.companyId,
        tenantId,
        invoice.environment,
      );
      if (!company) throw new Error('Invoice company not found');
      const { subject, html, text } = nfseDocumentsReadyEmail({
        companyName: company?.tradeName ?? company?.legalName ?? 'Corvo',
        customerName: snapshot.customerSnapshot?.name ?? 'Consumidor',
        amount: formatBrl(Number(snapshot.amount)),
        number: String(nfseNumber),
        issueDate: formatDateBr(snapshot.issuedAt ?? new Date()),
        description: snapshot.serviceSnapshot.description,
        accessKey: snapshot.accessKey ?? '—',
        isTest: invoice.environment === 'test',
      });

      await this.emailProvider.send({
        to: [customerEmail],
        subject,
        html,
        text,
        attachments: [
          {
            filename: `nfse-${nfseNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
          {
            filename: `nfse-${nfseNumber}.xml`,
            content: Buffer.from(xmlString, 'utf-8'),
            contentType: 'application/xml',
          },
        ],
        idempotencyKey: job.id,
      });

      const sentAt = new Date();
      await this.invoiceRepo.updateEmailStatus(
        invoiceId,
        tenantId,
        'sent',
        sentAt,
      );
      await this.workflow.emailSent(invoice, sentAt);
      this.logger.log(
        `NfseEmailProcessor: email sent for invoice ${invoiceId}`,
      );
    } catch (e: unknown) {
      if (e instanceof PermanentEmailError) {
        // A bad address stays bad on every retry: record it now and end the job.
        this.logger.warn(
          { invoiceId, reason: e.message },
          'NfseEmailProcessor: provider refused the e-mail, not retrying',
        );
        const invoice = await this.invoiceRepo.findByIdAndTenantId(
          invoiceId,
          tenantId,
        );
        await this.invoiceRepo.updateEmailStatus(invoiceId, tenantId, 'failed');
        if (invoice) await this.workflow.emailFailed(invoice);
        return;
      }
      this.logger.error(
        { err: e, invoiceId },
        'NfseEmailProcessor: process failed',
      );
      throw e;
    } finally {
      await this.lockService.release(lock);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NfseEmailJobData>): Promise<void> {
    const { invoiceId, tenantId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;

    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        `NfseEmailProcessor: all ${maxAttempts} attempts exhausted for invoice ${invoiceId}, marking as failed`,
      );
      const invoice = await this.invoiceRepo.findByIdAndTenantId(
        invoiceId,
        tenantId,
      );
      if (!invoice) return;
      await this.invoiceRepo.updateEmailStatus(invoiceId, tenantId, 'failed');
      await this.workflow.emailFailed(invoice);
    }
  }
}
