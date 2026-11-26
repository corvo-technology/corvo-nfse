import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  buildCorrectionEvent,
  MAX_CORRECTIONS,
} from '../domain/builder/env-evento.builder';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { CORRECTION_TP_EVENTO, type NfeFiscalEvent } from '../domain/nfe-event';
import { isAcceptedText } from '../domain/validators/text-charset.validator';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import {
  nfeCorrectionLength,
  nfeCorrectionLimit,
  nfeInvalidState,
  nfeNotFound,
  nfeValidationFailed,
} from './nfe-errors';
import { NfeEventContext } from './nfe-event-context';
import { eventSendMessage } from './nfe-messages';
import { keyOf } from './nfe-outcome.service';
import { NfeSefazAccess } from './nfe-sefaz-access';
import { NfeTransitionService } from './nfe-transition.service';

export const CORRECTION_MIN = 15;
export const CORRECTION_MAX = 1000;

/**
 * `POST /v1/nfe/{id}/corrections`. Under the lock of the document row, the next `nSeqEvento` is
 * `max + 1` of the letters already made (rejected ones included), so two letters sent at the same
 * time never share a number. The signed request is stored as a `pending` event and `nfe.correct`
 * is queued; the NF-e stays `authorized` (a letter does not change its state).
 */
@Injectable()
export class NfeCorrectService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly context: NfeEventContext,
    private readonly access: NfeSefazAccess,
    private readonly transitions: NfeTransitionService,
    private readonly events: TypeormNfeEvents,
  ) {}

  async correct(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    correctionText: string,
  ): Promise<NfeFiscalEvent> {
    const correction = correctionText.trim();
    if (
      correction.length < CORRECTION_MIN ||
      correction.length > CORRECTION_MAX
    )
      throw nfeCorrectionLength();
    if (!isAcceptedText(correction))
      throw nfeValidationFailed([
        {
          field: 'correction',
          code: 'TEXT_CHARSET_INVALID',
          message:
            'Use only letters, digits and common punctuation (no emoji, line breaks or control characters)',
        },
      ]);
    this.context.assertEnvironment(environment);
    const current = await this.documents.findById(id, tenantId, environment);
    if (!current) throw nfeNotFound();
    if (current.status !== 'authorized')
      throw nfeInvalidState(current.status, 'corrected');

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
    const tpAmb = this.access.tpAmb(environment);
    const eventId = randomUUID();
    let created: NfeFiscalEvent | undefined;

    await this.transitions.touch(keyOf(current), {
      change: async (locked) => {
        // The row is locked here: the status and the sequence are read under the lock.
        if (locked.status !== 'authorized')
          throw nfeInvalidState(locked.status, 'corrected');
        const nSeq =
          (await this.events.maxSequence(
            locked.id,
            tenantId,
            CORRECTION_TP_EVENTO,
          )) + 1;
        if (nSeq > MAX_CORRECTIONS) throw nfeCorrectionLimit();
        const built = buildCorrectionEvent({
          accessKey: locked.toSnapshot().accessKey as string,
          cnpj: issuer.cnpj,
          cOrgao: issuer.cUF,
          tpAmb,
          dhEvento: dhEmiFor(issuer.uf, new Date()),
          nSeq,
          correction,
        });
        const requestXml = this.access.sign(
          built.xml,
          certificate,
          environment,
          built.referenceTag,
        );
        await this.events.insert({
          id: eventId,
          tenantId,
          documentId: locked.id,
          tpEvento: CORRECTION_TP_EVENTO,
          nSeq,
          text: correction,
          requestXml,
        });
        created = (await this.events.find(eventId, tenantId)) ?? undefined;
      },
      messages: [
        eventSendMessage(
          current,
          { id: eventId, tpEvento: CORRECTION_TP_EVENTO },
          'first',
        ),
      ],
    });
    if (!created) throw nfeNotFound();
    return created;
  }
}
