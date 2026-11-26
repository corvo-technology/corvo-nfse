/** Outbox message types of the NF-e module, registered in the existing `OutboxHandlerRegistry`. */
export const NFE_EMIT = 'nfe.emit';
export const NFE_RECONCILE = 'nfe.reconcile';
export const NFE_CANCEL = 'nfe.cancel';
export const NFE_CORRECT = 'nfe.correct';
export const NFE_INUTILIZE = 'nfe.inutilize';
export const NFE_PREPARE_DOCUMENTS = 'nfe.prepare_documents';

/**
 * What every NF-e message carries: ids only. Never the certificate, the XML or the recipient's
 * CPF/CNPJ (the environment travels in the message itself).
 */
export interface NfeMessagePayload {
  documentId: string;
  tenantId: string;
  companyId: string;
}

/** What an event message carries: the document and the event (ids only), and which look this is. */
export interface NfeEventMessagePayload extends NfeMessagePayload {
  eventId: string;
  attempt: number;
}

/** What `nfe.inutilize` carries: the request to send (ids only). */
export interface NfeInutilizeMessagePayload {
  inutilizationId: string;
  tenantId: string;
  companyId: string;
  attempt: number;
}
