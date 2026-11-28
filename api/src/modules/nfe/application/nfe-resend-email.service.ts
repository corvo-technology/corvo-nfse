import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import {
  nfeCancelledNoEmail,
  nfeDocumentsNotReady,
  nfeEmailKeyInvalid,
  nfeNotFound,
  nfeRecipientEmailMissing,
} from './nfe-errors';
import { resendEmailMessage } from './nfe-messages';
import { keyOf } from './nfe-outcome.service';
import { NfeTransitionService } from './nfe-transition.service';

/**
 * "Send the e-mail again" for an authorized NF-e or NFC-e: checks the note and queues the send
 * (the worker has the mail provider). A repeated `Idempotency-Key` is the same request.
 */
@Injectable()
export class NfeResendEmailService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly transitions: NfeTransitionService,
  ) {}

  async request(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    model: 55 | 65,
    options: { toEmail?: string; idempotencyKey?: string },
  ): Promise<{ emailId: string; status: 'queued' }> {
    const doc = await this.documents.findById(id, tenantId, environment, {
      model,
    });
    if (!doc) throw nfeNotFound();
    const s = doc.toSnapshot();
    if (s.status === 'cancelled') throw nfeCancelledNoEmail();
    if (s.status !== 'authorized' || !s.documentsReadyAt)
      throw nfeDocumentsNotReady();
    const to = options.toEmail ?? s.recipient?.email;
    if (!to) throw nfeRecipientEmailMissing();
    const key = options.idempotencyKey;
    if (key && !/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw nfeEmailKeyInvalid();

    const emailId = key ?? `eml_${Date.now()}_${randomUUID().split('-')[0]}`;
    await this.transitions.touch(keyOf(doc), {
      messages: [resendEmailMessage(doc, emailId, options.toEmail)],
    });
    return { emailId, status: 'queued' };
  }
}
