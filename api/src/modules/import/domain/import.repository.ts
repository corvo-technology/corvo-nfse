import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type {
  ImportCounters,
  ImportRecord,
  ImportRow,
  ImportStatus,
  NewImport,
  RowPage,
  RowPageQuery,
} from './import';

export abstract class ImportRepository {
  abstract create(input: NewImport): Promise<ImportRecord>;
  abstract findById(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportRecord | null>;
  abstract updateStatus(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ImportRecord,
        | 'status'
        | 'errorCode'
        | 'unknownColumns'
        | 'rowsExpected'
        | 'emitStartedAt'
        | 'emitFinishedAt'
        | 'userId'
      >
    > & { status: ImportStatus },
  ): Promise<void>;
  abstract insertRows(
    tenantId: string,
    importId: string,
    rows: ImportRow[],
  ): Promise<void>;
  /** Drops every row, so a retried reading job starts clean. */
  abstract deleteRows(tenantId: string, importId: string): Promise<void>;
  abstract counters(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportCounters>;
  /** Counters of several imports in one query. Imports with no rows get all zeros. */
  abstract countersMany(
    tenantId: string,
    env: ExecutionEnvironment,
    ids: string[],
  ): Promise<Map<string, ImportCounters>>;
  /** Newest imports first, for the "recent imports" list. */
  abstract listRecent(
    tenantId: string,
    env: ExecutionEnvironment,
    limit: number,
  ): Promise<ImportRecord[]>;
  /** Accepted rows whose invoice failed afterwards, with the invoice's own error. */
  abstract listFailedInvoices(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
    query: { cursor?: string; limit: number },
  ): Promise<RowPage>;
  abstract listRows(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
    query: RowPageQuery,
  ): Promise<RowPage>;
  /** Moves ready or done to emitting, once: false when someone else already did. */
  abstract claimEmit(tenantId: string, importId: string): Promise<boolean>;
  /**
   * Queues what can be emitted: valid rows, rows already queued, and rows rejected for one of
   * `retryCodes` (plan limits). Returns how many rows are queued now.
   */
  abstract markRowsQueued(
    tenantId: string,
    importId: string,
    retryCodes: string[],
  ): Promise<number>;
  /** Turns on the email send for queued rows that have a customer email. */
  abstract enableEmailOnQueued(
    tenantId: string,
    importId: string,
  ): Promise<void>;
  /** Rejects every row still queued with one error (the plan limit was reached). */
  abstract rejectQueued(
    tenantId: string,
    importId: string,
    error: { code: string; message: string },
  ): Promise<void>;
  /** Closes an emitting import as done, only if no row is still queued. False when it did not apply. */
  abstract markDone(tenantId: string, importId: string): Promise<boolean>;
  /** Imports of this workspace still emitting that started before `startedBefore`, oldest first. */
  abstract listEmittingStartedBefore(
    tenantId: string,
    startedBefore: Date,
    limit: number,
  ): Promise<ImportRecord[]>;
  /** Updates a row only while the import is ready and the row is valid or invalid. False when it did not apply. */
  abstract updateEditableRow(
    tenantId: string,
    importId: string,
    line: number,
    patch: Partial<Omit<ImportRow, 'line'>>,
  ): Promise<boolean>;
  abstract findRow(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
    line: number,
  ): Promise<ImportRow | null>;
  abstract updateRow(
    tenantId: string,
    importId: string,
    line: number,
    patch: Partial<Omit<ImportRow, 'line'>>,
  ): Promise<void>;
  /** Writes the result of many rows of one import in a single statement (one round trip per chunk). */
  abstract settleRows(
    tenantId: string,
    importId: string,
    settled: Array<{
      line: number;
      status: 'accepted' | 'rejected';
      invoiceId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>,
  ): Promise<void>;
  abstract findByFileHash(
    tenantId: string,
    env: ExecutionEnvironment,
    companyId: string | null,
    fileHash: string,
  ): Promise<ImportRecord | null>;
  /** Housekeeping across tenants: drops imports (and their rows) created more than `days` ago. */
  abstract deleteOlderThan(days: number): Promise<number>;
  /** Deletes only while the status is one of `statuses`: false when an Emit got there first. */
  abstract deleteIfStatus(
    tenantId: string,
    id: string,
    statuses: ImportStatus[],
  ): Promise<boolean>;
  /** Housekeeping across tenants: fails imports left `processing` for more than `hours`, with or without a file. */
  abstract failStuck(hours: number): Promise<number>;
  abstract delete(tenantId: string, id: string): Promise<void>;
}
