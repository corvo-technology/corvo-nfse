import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Invoice } from './invoice';
import { InvoiceStatus } from './invoice-status';
import { LastEmailStatus } from './invoice';

export interface ListInvoicesFilters {
  environment?: ExecutionEnvironment;
  companyId?: string;
  status?: InvoiceStatus;
  from?: Date;
  to?: Date;
  externalId?: string;
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
  save(invoice: Invoice, tenantId: string): Promise<Invoice>;
  /** Persists only the DPS identity; never overwrites status or other fields. */
  saveDpsInfo(invoice: Invoice): Promise<void>;
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
   * Finds authorized invoices that still lack documents, older than `olderThan`.
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
  findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<import('./invoice-event').InvoiceEvent[]>;
}

export const INVOICE_REPOSITORY = 'INVOICE_REPOSITORY';
export const INVOICE_EVENT_REPOSITORY = 'INVOICE_EVENT_REPOSITORY';
