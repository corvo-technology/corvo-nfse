import type { NewOutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { NfeDocument } from '../domain/nfe-document';
import {
  NFE_CANCEL,
  NFE_CORRECT,
  NFE_EMIT,
  NFE_INUTILIZE,
  NFE_PREPARE_DOCUMENTS,
  NFE_RECONCILE,
  type NfeEventMessagePayload,
  type NfeInutilizeMessagePayload,
  type NfeMessagePayload,
} from '../domain/nfe-message-types';
import type { NfeInutilization } from '../domain/nfe-event';
import { CANCEL_TP_EVENTO } from '../domain/nfe-event';

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

export function prepareDocumentsMessage(doc: NfeDocument): NewOutboxMessage {
  return base(doc, NFE_PREPARE_DOCUMENTS, `prepare:${doc.id}`);
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
