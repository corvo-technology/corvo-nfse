import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { PackageSummaryRow } from '../application/package/package-summary-csv';

/** One company, one environment, one competence month (YYYY-MM): what a package holds. */
export interface PackageScope {
  tenantId: string;
  companyId: string;
  environment: ExecutionEnvironment;
  month: string;
}

/** An invoice of the package, with what the summary sheet and the storage lookup need. */
export interface PackageInvoice {
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  documentKeyVersion: number;
  documentsReady: boolean;
  summary: Omit<PackageSummaryRow, 'documents'>;
}

/** Reads of the month package: authorized and cancelled invoices only. */
export abstract class IInvoicePackageRepository {
  abstract summarize(
    scope: PackageScope,
  ): Promise<{ count: number; total: string }>;
  /** Ordered by NFS-e number; at most `limit` rows. */
  abstract list(scope: PackageScope, limit: number): Promise<PackageInvoice[]>;
}

/** Date range [start, end) of a YYYY-MM month, as pure dates (no time zone involved). */
export function monthRange(month: string): { start: string; end: string } {
  const [year, mm] = month.split('-').map(Number);
  const next =
    mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${next}-01` };
}
