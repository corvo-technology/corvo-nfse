import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { InvoiceEvent } from './invoice-event';
import { Invoice } from './invoice';
import { InvoiceStatus } from './invoice-status';
import { LastEmailStatus } from './invoice';
import type { CancellationReasonCode } from './cancellation-reason';
import type { PortalFlag } from './portal-flag';

import type { InvoiceOrigin } from './invoice-origin';

export interface ListInvoicesFilters {
  environment?: ExecutionEnvironment;
  companyId?: string;
  status?: InvoiceStatus;
  from?: Date;
  to?: Date;
  externalId?: string;
  /** CPF/CNPJ digits of the customer snapshot. */
  customerTaxId?: string;
  /** Where the invoice came from; see `originOf`. */
  origin?: InvoiceOrigin;
}

/** A cancellation requested while the invoice is being issued. */
export interface CancellationIntent {
  code: CancellationReasonCode;
  description: string | null;
  requestedAt: Date;
}

export interface SaveInvoiceOptions {
  /**
   * Leaves cancellation_reason, cancellation_description and
   * cancellation_requested_at untouched, so a stale in-memory copy cannot erase
   * an intent registered concurrently.
   */
  preserveCancellationRequest?: boolean;
}

export interface IInvoiceRepository {
  /** True when a substitute NFS-e (one with an access key) replaces this invoice. */
  hasSubstitute(originalId: string, tenantId: string): Promise<boolean>;
  findByAccessKeyAndTenantId(
    accessKey: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Invoice | null>;
  listPage(
    tenantId: string,
    filters: ListInvoicesFilters,
    options: CursorQuery,
  ): Promise<CursorPage<Invoice>>;
  /**
   * `forUpdate` locks the row (SELECT ... FOR UPDATE) until the surrounding
   * transaction ends; it must run inside one.
   */
  findByIdAndTenantId(
    id: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
    options?: { forUpdate?: boolean },
  ): Promise<Invoice | null>;
  findByIdempotencyKey(
    key: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Invoice | null>;
  findByTenantId(
    tenantId: string,
    filters?: ListInvoicesFilters,
    limit?: number,
    cursor?: string,
  ): Promise<Invoice[]>;
  insert(invoice: Invoice, tenantId: string): Promise<void>;
  findPendingReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>>;
  /** Invoices parked in manual review that are not older than `since`, in no fixed order. */
  findManualReview(
    tenantId: string,
    since: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>>;
  save(
    invoice: Invoice,
    tenantId: string,
    options?: SaveInvoiceOptions,
  ): Promise<Invoice>;
  /**
   * Sets or clears the portal badge. Kept out of `save` on purpose: only the portal event
   * processor writes it, so a stale copy of the invoice can never overwrite it.
   */
  setPortalFlag(
    invoiceId: string,
    tenantId: string,
    flag: PortalFlag | null,
  ): Promise<void>;
  /** Persists only the DPS identity; never overwrites status or other fields. */
  saveDpsInfo(invoice: Invoice): Promise<void>;
  /**
   * First-write-wins: records the intent only on a `processing` invoice that has
   * none yet. Returns true when this call actually wrote it.
   *
   * Safe against the worker because `transition()` reads the row FOR UPDATE:
   * an intent committed before that read is seen and applied on authorization;
   * one sent after it blocks on the row lock until the transition commits, then
   * re-evaluates `status = 'processing'`, matches no row and returns false, so
   * the caller re-reads the invoice and decides again.
   */
  registerCancellationIntent(
    invoiceId: string,
    tenantId: string,
    intent: CancellationIntent,
  ): Promise<boolean>;
  existsIdempotencyKey(
    key: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<boolean>;
  /**
   * First-write-wins: sets documents_ready_at only if still NULL.
   * Returns true when this call actually filled the column.
   */
  markDocumentsReady(
    invoiceId: string,
    tenantId: string,
    at: Date,
  ): Promise<boolean>;
  updateEmailStatus(
    invoiceId: string,
    tenantId: string,
    status: LastEmailStatus,
    sentAt?: Date,
    onlyIfUnset?: boolean,
  ): Promise<void>;
  /**
   * Finds invoices that were authorized (status authorized, cancelling or
   * cancelled) and still lack documents, older than `olderThan`. The pending
   * automatic-email recovery applies only to still-authorized invoices.
   */
  findAuthorizedWithoutDocuments(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>>;
}

export interface IInvoiceEventRepository {
  listPage(
    invoiceId: string,
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<import('./invoice-event').InvoiceEvent>>;
  save(
    event: import('./invoice-event').InvoiceEvent,
    tenantId: string,
  ): Promise<void>;
  findByInvoiceId(invoiceId: string, tenantId: string): Promise<InvoiceEvent[]>;
  /**
   * Timeline entry of a portal document: a second write of the same invoice and NSU is ignored.
   * Returns true when this call wrote it.
   */
  savePortalEntry(
    event: import('./invoice-event').InvoiceEvent,
    tenantId: string,
  ): Promise<boolean>;
}

export const INVOICE_REPOSITORY = 'INVOICE_REPOSITORY';
export const INVOICE_EVENT_REPOSITORY = 'INVOICE_EVENT_REPOSITORY';
