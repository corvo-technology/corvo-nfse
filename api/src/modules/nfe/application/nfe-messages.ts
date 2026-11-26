import type { NewOutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { NfeDocument } from '../domain/nfe-document';
import {
  NFE_EMIT,
  NFE_PREPARE_DOCUMENTS,
  NFE_RECONCILE,
  type NfeMessagePayload,
} from '../domain/nfe-message-types';

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
