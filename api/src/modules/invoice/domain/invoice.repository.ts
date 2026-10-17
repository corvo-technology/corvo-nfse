import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { InvoiceEvent } from './invoice-event';
import { Invoice } from './invoice';
import { InvoiceStatus } from './invoice-status';
import { LastEmailStatus } from './invoice';
import type { CancellationReasonCode } from './cancellation-reason';

export interface ListInvoicesFilters {
  environment?: ExecutionEnvironment;
  companyId?: string;
  status?: InvoiceStatus;
  from?: Date;
  to?: Date;
  externalId?: string;
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
  findByIdAndTenantId(
    id: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
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
  save(
    invoice: Invoice,
    tenantId: string,
    options?: SaveInvoiceOptions,
  ): Promise<Invoice>;
  /** Persists only the DPS identity; never overwrites status or other fields. */
  saveDpsInfo(invoice: Invoice): Promise<void>;
  /**
   * First-write-wins: records the intent only on a `processing` invoice that has
   * none yet. Returns true when this call actually wrote it.
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
}

export const INVOICE_REPOSITORY = 'INVOICE_REPOSITORY';
export const INVOICE_EVENT_REPOSITORY = 'INVOICE_EVENT_REPOSITORY';
