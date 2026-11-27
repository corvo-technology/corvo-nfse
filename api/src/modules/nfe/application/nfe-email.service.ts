import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  nfceAuthorizedEmail,
  nfeAuthorizedEmail,
} from '@/infra/external/email/email-templates';
import {
  MillionSendEmailProvider,
  PermanentEmailError,
} from '@/infra/external/email/mmsend-email.provider';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
  type StorageRef,
} from '@/infra/storage/domain/document-storage';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { formatBrl } from '@/shared/utils/currency';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { DANFCE_FILE, DANFE_FILE, NFE_PROC_FILE } from './nfe-files';
import { keyOf } from './nfe-outcome.service';
import {
  NfeTransitionService,
  documentTypeOf,
  nfeEventName,
} from './nfe-transition.service';

const dateBr = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
});

/**
 * The e-mail of an authorized NF-e or NFC-e to its recipient: the `nfeProc` and the DANFE (the
 * DANFCE, for a NFC-e: only when the consumer gave an address) attached, in the
 * same pipeline and template format as the NFS-e one (`[TESTE]` in the subject for a test
 * company). Runs once per NF-e (its outbox message has a dedupe key and the provider call an
 * idempotency key). The recipient's address and the XML never go to a log.
 */
@Injectable()
export class NfeEmailService {
  private readonly logger = new Logger(NfeEmailService.name);

  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: IDocumentStorage,
    private readonly companies: ICompanyRepository,
    private readonly transitions: NfeTransitionService,
    private readonly webhooks: FiscalWebhookPublisher,
    // Only the worker has the provider (its module is registered there).
    @Optional() private readonly mailer?: MillionSendEmailProvider,
  ) {}

  /**
   * Sends the e-mail. A refusal of the provider ends it `failed` at once; any other error is
   * thrown for another try, until `lastAttempt`, which ends it `failed` too.
   */
  async send(
    documentId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    lastAttempt: boolean,
  ): Promise<void> {
    const doc = await this.documents.findById(
      documentId,
      tenantId,
      environment,
    );
    if (!doc) return;
    const s = doc.toSnapshot();
    // Never after a cancellation; a second delivery of the message finds it already sent.
    if (s.status !== 'authorized' || s.emailStatus === 'sent') return;
    const to = s.recipient?.email;
    if (!to || !s.documentsReadyAt) return;

    try {
      const sentAt = await this.deliver(doc, to);
      await this.transitions.touch(keyOf(doc), {
        change: (locked) => locked.recordEmail('sent', sentAt),
      });
      await this.publish(doc, 'document.email_sent', {
        emailStatus: 'sent',
        sentAt: sentAt.toISOString(),
      });
      this.logger.log(
        { documentId },
        `${doc.toSnapshot().model === 65 ? 'NFC-e' : 'NF-e'} e-mail sent`,
      );
    } catch (error: unknown) {
      if (!(error instanceof PermanentEmailError) && !lastAttempt) throw error;
      this.logger.warn(
        { documentId, permanent: error instanceof PermanentEmailError },
        'NF-e e-mail failed, not trying again',
      );
      await this.transitions.touch(keyOf(doc), {
        change: (locked) => locked.recordEmail('failed'),
      });
      await this.publish(doc, 'document.email_failed', {
        emailStatus: 'failed',
      });
    }
  }

  private async deliver(doc: NfeDocument, to: string): Promise<Date> {
    if (!this.mailer) throw new Error('The e-mail provider is not available');
    const s = doc.toSnapshot();
    const ref: StorageRef = {
      type: 'nfe',
      id: doc.id,
      tenantId: doc.tenantId,
      environment: doc.environment,
    };
    const isNfce = s.model === 65;
    const [xml, pdf] = await Promise.all([
      this.storage.getFile(ref, NFE_PROC_FILE),
      this.storage.getFile(ref, isNfce ? DANFCE_FILE : DANFE_FILE),
    ]);
    const company = await this.companies.findByIdAndTenantId(
      s.companyId,
      s.tenantId,
      s.environment,
    );
    if (!company) throw new Error('NF-e company not found');
    const number = String(s.number ?? '');
    const template = isNfce ? nfceAuthorizedEmail : nfeAuthorizedEmail;
    const { subject, html, text } = template({
      companyName: company.tradeName ?? company.legalName,
      customerName: s.recipient?.name ?? '',
      amount: formatBrl(Number(s.totals.vNF)),
      number,
      series: String(s.series ?? ''),
      issueDate: dateBr.format(s.issuedAt ?? s.authorizedAt ?? new Date()),
      accessKey: s.accessKey ?? '-',
      isTest: s.environment === 'test',
    });
    await this.mailer.send({
      to: [to],
      subject,
      html,
      text,
      attachments: [
        {
          filename: `${isNfce ? 'nfce' : 'nfe'}-${number}.xml`,
          content: xml,
          contentType: 'application/xml',
        },
        {
          filename: `${isNfce ? 'danfce' : 'danfe'}-${number}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
      idempotencyKey: `${isNfce ? 'nfce' : 'nfe'}-email-${doc.id}`,
    });
    return new Date();
  }

  private publish(
    doc: NfeDocument,
    suffix: 'document.email_sent' | 'document.email_failed',
    extra: Record<string, unknown>,
  ): Promise<void> {
    const s = doc.toSnapshot();
    return this.webhooks.publish(
      {
        type: documentTypeOf(s.model),
        id: s.id,
        tenantId: s.tenantId,
        environment: s.environment,
        companyId: s.companyId,
      },
      nfeEventName(s.model, suffix),
      {
        status: s.status,
        accessKey: s.accessKey,
        number: s.number,
        series: s.series,
        externalId: s.externalId,
        ...extra,
      },
    );
  }
}
