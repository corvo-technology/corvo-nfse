import type {
  ReconciliationDifference,
  ReconciliationStatus,
} from './reconcile';

export type { ReconciliationDifference, ReconciliationStatus };

export interface ReconciliationRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly status: ReconciliationStatus;
  readonly localValues: Record<string, string | null>;
  readonly authorizedValues: Record<string, string | null>;
  readonly differences: ReconciliationDifference[];
  readonly toleranceAbsolute: string;
  readonly rulesVersion: string;
  readonly reconciledAt: Date;
}

export type NewReconciliationRow = Omit<ReconciliationRow, 'id'>;

export const FISCAL_RECONCILIATION_REPOSITORY =
  'FISCAL_RECONCILIATION_REPOSITORY';

export abstract class IFiscalReconciliationRepository {
  /** Idempotent insert: `true` when the row was created, `false` on a redelivery. */
  abstract insert(row: NewReconciliationRow): Promise<boolean>;
  abstract findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<ReconciliationRow | null>;
  abstract findAuthorizedWithoutReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>>;
}
