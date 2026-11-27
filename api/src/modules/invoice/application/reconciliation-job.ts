import { HttpStatusError } from 'open-nfse';

/**
 * One reconciliation chain per invoice. Each attempt is a job whose id is the invoice plus the
 * attempt parity, so the next attempt never collides with the running one, while a second
 * chain for the same invoice (recovery, manual retry) collides and is ignored by the queue.
 * Jobs are removed when they finish or fail, so an id is only taken while the job is pending.
 */
export function reconciliationJobKey(
  invoiceId: string,
  attempt: number,
): string {
  return `reconcile:${invoiceId}:${attempt % 2}`;
}

/** Both slots of an invoice: a chain always holds one of them while it is queued or running. */
export function reconciliationJobKeys(invoiceId: string): [string, string] {
  return [
    reconciliationJobKey(invoiceId, 0),
    reconciliationJobKey(invoiceId, 1),
  ];
}

/** BullMQ states in which a job is still going to run (or is running). */
const PENDING_STATES = new Set([
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
]);

export function isPendingJobState(state: string | null): boolean {
  return state !== null && PENDING_STATES.has(state);
}

/** True when the portal answered the DPS lookup with HTTP 400 ("identificador de DPS inválido"). */
export function isPortalLookupRejected(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === 400;
}

/**
 * Short text of an HTTP error body that is safe to log and show: no markup, no CPF/CNPJ,
 * e-mail or token-like strings, no line breaks, at most 300 characters.
 */
export function sanitizePortalBody(body: string | undefined): string {
  if (!body) return '';
  return body
    .replace(/<[^>]*>?/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '[token]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Sanitized body of an HTTP error from the portal, or '' when there is none. */
export function portalBodyOf(error: unknown): string {
  return error instanceof HttpStatusError ? sanitizePortalBody(error.body) : '';
}

/** Error code and text of an invoice whose DPS lookup the portal refused (HTTP 400). */
export const PORTAL_DPS_QUERY_REJECTED = 'PORTAL_DPS_QUERY_REJECTED';
export const PORTAL_DPS_QUERY_REJECTED_MESSAGE =
  'O portal recusou a consulta desta nota (código 400). Veja o detalhe.';
