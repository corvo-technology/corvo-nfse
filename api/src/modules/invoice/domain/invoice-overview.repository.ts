import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { Invoice } from './invoice';

export type OverviewPeriod = '7d' | '30d';
export interface OverviewDay {
  date: string;
  count: number;
}
export interface OverviewCounts {
  authorized: number;
  rejected: number;
  processing: number;
}
export interface OverviewRange {
  start: Date;
  end: Date;
  timezone: string;
}
/** A recent NF-e or NFC-e: the short line of the document, not the whole note. */
export interface OverviewNfeItem {
  id: string;
  type: 'nfe' | 'nfce';
  companyId: string;
  environment: string;
  status: string;
  number: number | null;
  accessKey: string | null;
  amount: string | null;
  recipientName: string | null;
  externalId: string | null;
  authorizedAt: Date | null;
  createdAt: Date;
}
/** An NFS-e is the full invoice (its JSON has `type: "nfse"`); NF-e and NFC-e are short lines. */
export type OverviewRecent = Invoice | OverviewNfeItem;
export interface InvoiceOverviewRead {
  counts: OverviewCounts;
  dailyActivity: OverviewDay[];
  recentInvoices: OverviewRecent[];
}
export const INVOICE_OVERVIEW_REPOSITORY = Symbol(
  'INVOICE_OVERVIEW_REPOSITORY',
);
export interface IInvoiceOverviewRepository {
  read(
    tenantId: string,
    environment: ExecutionEnvironment,
    range: OverviewRange,
  ): Promise<InvoiceOverviewRead>;
}
