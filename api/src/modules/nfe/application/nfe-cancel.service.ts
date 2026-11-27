import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { buildCancelEvent } from '../domain/builder/env-evento.builder';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { CANCEL_TP_EVENTO } from '../domain/nfe-event';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import { isAcceptedText } from '../domain/validators/text-charset.validator';
import {
  nfeInvalidState,
  nfeJustificationLength,
  nfeNotFound,
  nfeValidationFailed,
} from './nfe-errors';
import { NfeEventContext } from './nfe-event-context';
import { eventSendMessage } from './nfe-messages';
import { keyOf } from './nfe-outcome.service';
import { NfeSefazAccess } from './nfe-sefaz-access';
import { NfeTransitionService } from './nfe-transition.service';

export const JUSTIFICATION_MIN = 15;
export const JUSTIFICATION_MAX = 255;

/** Trims, counts and checks the text a SEFAZ event or inutilization carries as `xJust`. */
export function checkedJustification(raw: string): string {
  const text = raw.trim();
  if (text.length < JUSTIFICATION_MIN || text.length > JUSTIFICATION_MAX)
    throw nfeJustificationLength();
  if (!isAcceptedText(text))
    throw nfeValidationFailed([
      {
        field: 'justification',
        code: 'TEXT_CHARSET_INVALID',
        message:
          'Use only letters, digits and common punctuation (no emoji, line breaks or control characters)',
      },
    ]);
  return text;
}

/**
 * `POST /v1/invoices/{id}/cancel`. In one transaction, under the document lock: `authorized` becomes
 * `cancelling`, the signed cancellation request is stored as a `pending` event (`nSeqEvento` is
 * always 1) and `nfe.cancel` is queued. The send, the SEFAZ answer and the credit (a cancellation
 * after the authorization never gives it back) are settled by the handler.
 */
@Injectable()
export class NfeCancelService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly context: NfeEventContext,
    private readonly access: NfeSefazAccess,
    private readonly transitions: NfeTransitionService,
    private readonly events: TypeormNfeEvents,
  ) {}

  async cancel(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    justificationText: string,
  ): Promise<NfeDocument> {
    const justification = checkedJustification(justificationText);
    this.context.assertEnvironment(environment);
    const current = await this.documents.findById(id, tenantId, environment);
    if (!current) throw nfeNotFound();
    if (current.status !== 'authorized')
      throw nfeInvalidState(current.status, 'cancelled');

    const snapshot = current.toSnapshot();
    const issuer = await this.context.issuer(
      current.companyId,
      tenantId,
      environment,
    );
    const certificate = await this.context.certificateForRequest(
      current.companyId,
      tenantId,
      environment,
    );
    const built = buildCancelEvent({
      accessKey: snapshot.accessKey as string,
      cnpj: issuer.cnpj,
      cOrgao: issuer.cUF,
      tpAmb: this.access.tpAmb(environment),
      dhEvento: dhEmiFor(issuer.uf, new Date()),
      nSeq: 1,
      protocol: snapshot.protocol as string,
      justification,
    });
    const requestXml = this.access.sign(
      built.xml,
      certificate,
      environment,
      built.referenceTag,
    );

    // A cancellation the SEFAZ refused used no sequence number: the same event is asked again.
    const previous = await this.events.findBySequence(
      id,
      tenantId,
      CANCEL_TP_EVENTO,
      1,
    );
    const retry = previous?.status === 'rejected' ? previous : null;
    const eventId = retry?.id ?? randomUUID();
    const result = await this.transitions.apply(keyOf(current), 'cancelling', {
      from: ['authorized'],
      change: async (locked) => {
        locked.recordCancellationRequest(justification);
        locked.clearError();
        if (retry)
          await this.events.restart(
            retry.id,
            tenantId,
            justification,
            requestXml,
          );
        else
          await this.events.insert({
            id: eventId,
            tenantId,
            documentId: locked.id,
            tpEvento: CANCEL_TP_EVENTO,
            nSeq: 1,
            text: justification,
            requestXml,
          });
      },
      messages: [
        eventSendMessage(
          current,
          { id: eventId, tpEvento: CANCEL_TP_EVENTO },
          retry ? `again-${Date.now()}` : 'first',
        ),
      ],
    });
    if (!result.applied)
      // Another cancellation won the lock between the read and the transaction.
      throw nfeInvalidState(result.document.status, 'cancelled');
    return result.document;
  }
}
