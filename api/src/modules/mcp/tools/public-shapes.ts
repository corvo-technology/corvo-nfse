import type { CreditTransaction } from '@/modules/credits/domain/credit-transaction';
import type { WebhookDelivery } from '@/modules/webhooks-config/domain/webhook-delivery';
import type { Invoice } from '@/modules/invoice/domain/invoice';

/** Keeps only the last 4 digits of a CPF/CNPJ. */
function maskTaxId(taxId: string | undefined): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}

/** Compact, public-safe view of an invoice: no tenant, keys or customer email. */
export function toPublicInvoice(invoice: Invoice) {
  const i = invoice.toJSON();
  return {
    type: 'nfse' as const,
    id: i.id,
    company_id: i.companyId,
    status: i.status,
    number: i.nfseNumber,
    amount: i.amount,
    currency: i.currency,
    competence_date: i.competenceDate,
    customer_name: i.customerSnapshot?.name ?? null,
    customer_tax_id: maskTaxId(i.customerSnapshot?.taxId),
    authorized_at: i.authorizedAt,
    created_at: i.createdAt,
    error_code: i.lastErrorCode,
    error_message: i.lastErrorMessage,
  };
}

/** Fields of an invoice that agents may see in the detail tools. Anything not listed stays hidden. */
const DETAILED_INVOICE_FIELDS = [
  'type',
  'id',
  'companyId',
  'environment',
  'externalId',
  'status',
  'customerSnapshot',
  'serviceSnapshot',
  'taxSnapshot',
  'amount',
  'discount',
  'deduction',
  'substitutesInvoiceId',
  'substitutionDescription',
  'currency',
  'competenceDate',
  'scheduledFor',
  'dpsId',
  'dpsSeries',
  'dpsNumber',
  'accessKey',
  'nfseNumber',
  'issuedAt',
  'authorizedAt',
  'lastErrorCode',
  'lastErrorMessage',
  'lastEmailStatus',
  'lastEmailSentAt',
  'cancellationReason',
  'cancellationDescription',
  'cancelledAt',
  'cancellationRequestedAt',
  'portalFlag',
  'createdAt',
  'documentsStatus',
  'emailStatus',
  'stage',
] as const;

/**
 * Detail view of an invoice for tools the agent acts on (nfse_get, nfse_list):
 * an allowlist, so a new internal field on the entity is never exposed by default.
 */
export function toDetailedInvoice(invoice: Invoice) {
  const json = invoice.toJSON() as Record<string, unknown>;
  const detail: Record<string, unknown> = {};
  for (const field of DETAILED_INVOICE_FIELDS) {
    if (field in json) detail[field] = json[field];
  }
  return detail;
}

/** Compact view of a credit transaction: no tenant, payment or invoice ids. */
export function toPublicCreditTransaction(tx: CreditTransaction) {
  const t = tx.toJSON();
  return {
    id: t.id,
    amount: t.amount,
    type: t.type,
    description: t.description ?? null,
    source: t.source ?? null,
    created_at: t.createdAt,
  };
}

const SNIPPET = 200;
const snippet = (text: string | undefined): string | null =>
  text ? text.slice(0, SNIPPET) : null;

/**
 * Compact view of a webhook delivery. An allowlist: no url (it may carry a token),
 * no event body, no signature or secret, and only a short piece of the endpoint's answer.
 */
export function toPublicWebhookDelivery(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    webhook_id: delivery.webhookConfigId,
    event_type: delivery.eventType,
    invoice_id: delivery.invoiceId ?? null,
    environment: delivery.environment,
    status: delivery.status,
    http_status: delivery.statusCode ?? null,
    attempts: delivery.retryCount,
    next_attempt_at: delivery.nextRetryAt ?? null,
    duration_ms: delivery.durationMs ?? null,
    error: snippet(delivery.lastError ?? delivery.errorMessage),
    response_snippet: snippet(delivery.responseBody),
    created_at: delivery.createdAt,
  };
}

/** Fields of an NF-e that agents may see. An allowlist: no XML, no log of the SEFAZ answer. */
const DETAILED_NFE_FIELDS = [
  'type',
  'id',
  'companyId',
  'environment',
  'model',
  'status',
  'series',
  'number',
  'accessKey',
  'issuedAt',
  'authorizedAt',
  'protocol',
  'cStat',
  'xMotivo',
  'cancelReason',
  'cancelRequestedAt',
  'natOp',
  'recipient',
  'items',
  'totals',
  'payment',
  'additionalInfo',
  'externalId',
  'documentsReady',
  'documentsReadyAt',
  'documentsStatus',
  'stage',
  'emailStatus',
  'emailSentAt',
  'attempt',
  'lastError',
  'nextCheckAt',
  // NFC-e only: the QR Code text (v3, no secret) and the consult page
  'qrCode',
  'urlChave',
  'createdAt',
  'updatedAt',
] as const;

/** Detail view of an NF-e (nfse_get): the API answer, filtered by an allowlist. */
export function toDetailedNfe(nfe: unknown): Record<string, unknown> {
  const json = nfe as Record<string, unknown>;
  const detail: Record<string, unknown> = {};
  for (const field of DETAILED_NFE_FIELDS)
    if (field in json) detail[field] = json[field];
  return detail;
}

/** Compact line of an NF-e in a list: the recipient is a name and the last 4 digits of the tax id. */
export function toPublicNfe(nfe: unknown) {
  const n = nfe as {
    type?: string;
    id: string;
    companyId: string;
    status: string;
    series: number | null;
    number: number | null;
    accessKey: string | null;
    totals?: { vNF?: string } | null;
    recipient?: { name?: string; taxId?: string } | null;
    authorizedAt: unknown;
    createdAt: unknown;
    lastError?: { code?: string; message?: string } | null;
  };
  return {
    type: n.type === 'nfce' ? ('nfce' as const) : ('nfe' as const),
    id: n.id,
    companyId: n.companyId,
    status: n.status,
    series: n.series,
    number: n.number,
    accessKey: n.accessKey,
    amount: n.totals?.vNF ?? null,
    recipientName: n.recipient?.name ?? null,
    recipientTaxId: maskTaxId(n.recipient?.taxId),
    authorizedAt: n.authorizedAt,
    createdAt: n.createdAt,
    errorCode: n.lastError?.code ?? null,
    errorMessage: n.lastError?.message ?? null,
  };
}
