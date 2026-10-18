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
export interface InvoiceOverviewRead {
  counts: OverviewCounts;
  dailyActivity: OverviewDay[];
  recentInvoices: Invoice[];
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
