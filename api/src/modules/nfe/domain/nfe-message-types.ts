/** Outbox message types of the NF-e module, registered in the existing `OutboxHandlerRegistry`. */
export const NFE_EMIT = 'nfe.emit';
export const NFE_RECONCILE = 'nfe.reconcile';
export const NFE_CANCEL = 'nfe.cancel';
export const NFE_CORRECT = 'nfe.correct';
export const NFE_INUTILIZE = 'nfe.inutilize';
export const NFE_PREPARE_DOCUMENTS = 'nfe.prepare_documents';
export const NFE_SEND_EMAIL = 'nfe.send_email';
/** The e-mail of an authorized note sent again, on request. */
export const NFE_RESEND_EMAIL = 'nfe.resend_email';
/** The warning of an off-line NFC-e that is 20 hours old and was not transmitted yet. */
export const NFCE_CONTINGENCY_ALERT = 'nfce.contingency_alert';

/**
 * What every NF-e message carries: ids only. Never the certificate, the XML or the recipient's
 * CPF/CNPJ (the environment travels in the message itself).
 */
export interface NfeMessagePayload {
  documentId: string;
  tenantId: string;
  companyId: string;
}

/** `nfe.resend_email`: which request this is, and the address when it is not the recipient's. */
export interface NfeResendEmailPayload extends NfeMessagePayload {
  emailId: string;
  toEmail?: string;
}

/**
 * `nfe.prepare_documents`: the documents of an authorized NF-e (no `eventId`), or the XML of an
 * event that the SEFAZ registered (with its `eventId`), after the NF-e was cancelled or corrected.
 */
export interface NfePrepareDocumentsPayload extends NfeMessagePayload {
  eventId?: string;
}

/** `nfe.prepare_documents` for the XML of an inutilization the SEFAZ approved (ids only). */
export interface NfePrepareInutilizationPayload {
  inutilizationId: string;
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
