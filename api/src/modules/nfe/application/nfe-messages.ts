import type { NewOutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { NfeDocument } from '../domain/nfe-document';
import {
  NFCE_CONTINGENCY_ALERT,
  NFE_CANCEL,
  NFE_CORRECT,
  NFE_EMIT,
  NFE_INUTILIZE,
  NFE_PREPARE_DOCUMENTS,
  NFE_RECONCILE,
  NFE_SEND_EMAIL,
  type NfeEventMessagePayload,
  type NfeInutilizeMessagePayload,
  type NfeMessagePayload,
  type NfePrepareInutilizationPayload,
} from '../domain/nfe-message-types';
import type { NfeInutilization } from '../domain/nfe-event';
import { CANCEL_TP_EVENTO } from '../domain/nfe-event';

/**
 * What helps the customer after the SEFAZ refused a cancellation. A NFC-e can only be cancelled in
 * the window the state allows (30 minutes in SP); cStat 501 is "prazo de cancelamento superior ao
 * previsto" [cStat 501 a verificar na homologação]. Nothing for the NF-e: its text is the SEFAZ's.
 */
export function cancellationHint(
  model: 55 | 65,
  cStat: string,
): string | undefined {
  if (model === 65 && cStat === '501')
    return 'A NFC-e só pode ser cancelada em até 30 minutos depois da autorização. Depois disso, fale com o contador.';
  return undefined;
}

function base(
  doc: NfeDocument,
  type: string,
  dedupeKey: string,
  availableAt?: Date,
): NewOutboxMessage {
  const payload: NfeMessagePayload = {
    documentId: doc.id,
    tenantId: doc.tenantId,
    companyId: doc.companyId,
  };
  return {
    tenantId: doc.tenantId,
    environment: doc.environment,
    type,
    aggregateId: doc.id,
    payload: { ...payload },
    dedupeKey,
    ...(availableAt ? { availableAt } : {}),
  };
}

/** First send (`emit:<id>:1`) or the one after a resubmission (`emit:<id>:<attempt + 1>`). */
export function emitMessage(doc: NfeDocument): NewOutboxMessage {
  return base(doc, NFE_EMIT, `emit:${doc.id}:${doc.attempt + 1}`);
}

/**
 * The first transmission of an off-line NFC-e (`tpEmis` 9): it was numbered, keyed and signed when it
 * was issued, so this only sends that very XML (the emit handler reuses it, like a retry).
 */
export function transmitMessage(
  doc: NfeDocument,
  attempt: number = doc.attempt,
): NewOutboxMessage {
  return base(doc, NFE_EMIT, `emit:${doc.id}:${attempt}:offline`);
}

/**
 * The 20 h warning of an off-line NFC-e, queued with the note and due 20 hours after `dhCont`. The
 * handler looks at the state when it runs: a note already transmitted gets no warning.
 */
export function contingencyAlertMessage(
  doc: NfeDocument,
  availableAt: Date,
): NewOutboxMessage {
  return base(
    doc,
    NFCE_CONTINGENCY_ALERT,
    `contingency-alert:${doc.id}`,
    availableAt,
  );
}

/** The same attempt again, once the authority answers (never a new key: nothing was sent). */
export function emitRetryMessage(
  doc: NfeDocument,
  availableAt: Date,
): NewOutboxMessage {
  return base(
    doc,
    NFE_EMIT,
    `emit:${doc.id}:${doc.attempt}:retry:${availableAt.getTime()}`,
    availableAt,
  );
}

/**
 * `n` is the number of the look at the SEFAZ: each one has its own message. A look put off because
 * the authority is paused gets the suffix `p<time>`, so it never takes the key of the next real look.
 */
export function reconcileMessage(
  doc: NfeDocument,
  n: number | string,
  availableAt: Date,
): NewOutboxMessage {
  return base(
    doc,
    NFE_RECONCILE,
    `reconcile:${doc.id}:${doc.attempt}:${n}`,
    availableAt,
  );
}

/**
 * `nfe.prepare_documents`: with no event, the `nfeProc` and the DANFE of the authorization; with
 * the event, the XML the SEFAZ registered for it (and the DANFE again, marked, after a cancellation).
 */
export function prepareDocumentsMessage(
  doc: NfeDocument,
  eventId?: string,
): NewOutboxMessage {
  const message = base(
    doc,
    NFE_PREPARE_DOCUMENTS,
    eventId ? `prepare:${doc.id}:event:${eventId}` : `prepare:${doc.id}`,
  );
  return eventId
    ? { ...message, payload: { ...message.payload, eventId } }
    : message;
}

/** `nfe.prepare_documents` for the XML of an inutilization the SEFAZ approved. */
export function prepareInutilizationMessage(
  inutilization: Pick<NfeInutilization, 'id' | 'tenantId' | 'companyId'> & {
    environment: NfeInutilization['environment'];
  },
): NewOutboxMessage {
  const payload: NfePrepareInutilizationPayload = {
    inutilizationId: inutilization.id,
    tenantId: inutilization.tenantId,
    companyId: inutilization.companyId,
  };
  return {
    tenantId: inutilization.tenantId,
    environment: inutilization.environment,
    type: NFE_PREPARE_DOCUMENTS,
    aggregateId: inutilization.id,
    payload: { ...payload },
    dedupeKey: `prepare:inutilization:${inutilization.id}`,
  };
}

/** `nfe.send_email`: the NF-e to the recipient, once, with the documents ready. */
export function sendEmailMessage(doc: NfeDocument): NewOutboxMessage {
  return base(doc, NFE_SEND_EMAIL, `email:${doc.id}`);
}

/**
 * `nfe.cancel` or `nfe.correct` for one event. `sendKey` tells one send of the same event from
 * another (`first`, a retry after a pause, a resend after a look at the SEFAZ found nothing), so
 * the outbox never swallows a send as a duplicate of an earlier one.
 */
export function eventSendMessage(
  doc: NfeDocument,
  event: { id: string; tpEvento: string },
  sendKey: string,
  availableAt?: Date,
  attempt = 0,
): NewOutboxMessage {
  const type = event.tpEvento === CANCEL_TP_EVENTO ? NFE_CANCEL : NFE_CORRECT;
  const payload: NfeEventMessagePayload = {
    documentId: doc.id,
    tenantId: doc.tenantId,
    companyId: doc.companyId,
    eventId: event.id,
    attempt,
  };
  return {
    tenantId: doc.tenantId,
    environment: doc.environment,
    type,
    aggregateId: doc.id,
    payload: { ...payload },
    dedupeKey: `${type}:${event.id}:${sendKey}`,
    ...(availableAt ? { availableAt } : {}),
  };
}

/**
 * The look at the SEFAZ for an event whose answer was lost. `attempt` is the number of the look;
 * `paused` marks one put off (nothing was asked), so it never takes the key of the next real look.
 */
export function eventReconcileMessage(
  doc: NfeDocument,
  event: { id: string },
  attempt: number,
  availableAt: Date,
  paused = false,
): NewOutboxMessage {
  const payload: NfeEventMessagePayload = {
    documentId: doc.id,
    tenantId: doc.tenantId,
    companyId: doc.companyId,
    eventId: event.id,
    attempt,
  };
  return {
    tenantId: doc.tenantId,
    environment: doc.environment,
    type: NFE_RECONCILE,
    aggregateId: doc.id,
    payload: { ...payload },
    dedupeKey: `reconcile:event:${event.id}:${attempt}${paused ? `p${availableAt.getTime()}` : ''}`,
    availableAt,
  };
}

/** `nfe.inutilize`; `attempt` > 0 is the same request sent again after a timeout or a service pause. */
export function inutilizeMessage(
  inutilization: Pick<NfeInutilization, 'id' | 'tenantId' | 'companyId'> & {
    environment: NfeInutilization['environment'];
  },
  attempt = 0,
  availableAt?: Date,
): NewOutboxMessage {
  const payload: NfeInutilizeMessagePayload = {
    inutilizationId: inutilization.id,
    tenantId: inutilization.tenantId,
    companyId: inutilization.companyId,
    attempt,
  };
  return {
    tenantId: inutilization.tenantId,
    environment: inutilization.environment,
    type: NFE_INUTILIZE,
    aggregateId: inutilization.id,
    payload: { ...payload },
    dedupeKey: `${NFE_INUTILIZE}:${inutilization.id}:${attempt}`,
    ...(availableAt ? { availableAt } : {}),
  };
}
