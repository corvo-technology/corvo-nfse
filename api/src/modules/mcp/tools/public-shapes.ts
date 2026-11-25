import type { CreditTransaction } from '@/modules/credits/domain/credit-transaction';
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
