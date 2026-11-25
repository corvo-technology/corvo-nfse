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

/**
 * Detail view of an invoice for tools the agent acts on (nfse_get, nfse_list):
 * everything about the note and its customer, minus internal bookkeeping.
 */
export function toDetailedInvoice(invoice: Invoice) {
  const {
    tenantId: _tenantId,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    documentKeyVersion: _documentKeyVersion,
    fiscalSchemaVersion: _fiscalSchemaVersion,
    fiscalProvider: _fiscalProvider,
    lastErrorProvider: _lastErrorProvider,
    emailSnapshot: _emailSnapshot,
    documentsReadyAt: _documentsReadyAt,
    updatedAt: _updatedAt,
    ...detail
  } = invoice.toJSON() as ReturnType<Invoice['toJSON']> &
    Record<string, unknown>;
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
