import type { ImportCounters, ImportRow } from '../domain/import';
import type { ImportView } from '../application/import-review.service';
import type { StartImportResult } from '../application/import-intake.service';

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** What the API shows of an import: snake_case like every other resource, and nothing internal. */
export function toImportResponse(view: ImportView) {
  return {
    id: view.id,
    status: view.status,
    file_name: view.fileName,
    company_id: view.companyId,
    error_code: view.errorCode,
    emit_started_at: iso(view.emitStartedAt),
    emit_finished_at: iso(view.emitFinishedAt),
    created_at: iso(view.createdAt),
    counters: view.counters satisfies ImportCounters,
  };
}

export function toRowResponse(row: ImportRow) {
  return {
    line: row.line,
    data: row.data,
    status: row.status,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    invoice_id: row.invoiceId,
  };
}

export function toStartResponse(result: StartImportResult) {
  return {
    id: result.id,
    status: result.status,
    duplicate_of: result.duplicateOf,
  };
}
