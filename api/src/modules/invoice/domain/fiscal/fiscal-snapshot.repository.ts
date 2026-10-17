import type { TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import type { FiscalCalculationResult } from './fiscal-calculation-result';
import type { DecimalString } from './money';

/**
 * Immutable record of one fiscal calculation for an invoice. Money is kept as
 * DecimalString; the summary columns mirror the result's amounts into
 * numeric(15,2) at the persistence edge without ever passing through floats.
 */
export interface FiscalSnapshot {
  readonly id: string;
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly taxRegime: TaxRegimeKind;
  readonly profileId: string;
  readonly serviceProfileId: string | null;
  readonly specialTaxRegime: string | null;
  readonly attempt: number;
  readonly calculationVersion: string;
  readonly grossAmount: DecimalString;
  readonly discountAmount: DecimalString;
  readonly issAmount: DecimalString | null;
  readonly cbsAmount: DecimalString | null;
  readonly ibsTotalAmount: DecimalString | null;
  readonly netReceivableAmount: DecimalString;
  readonly result: FiscalCalculationResult;
  readonly calculatedAt: Date;
}

export type NewFiscalSnapshot = Omit<FiscalSnapshot, 'id'>;

export interface IFiscalSnapshotRepository {
  /** Idempotent on (invoiceId, attempt): a re-delivery returns the same id. */
  insert(snapshot: NewFiscalSnapshot): Promise<string>;
  /** Latest attempt for the invoice, or null when absent (tenant-scoped). */
  findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<FiscalSnapshot | null>;
}

export const FISCAL_SNAPSHOT_REPOSITORY = 'FISCAL_SNAPSHOT_REPOSITORY';
