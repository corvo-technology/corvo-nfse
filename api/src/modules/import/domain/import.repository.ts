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
        'status' | 'errorCode' | 'emitStartedAt' | 'emitFinishedAt' | 'userId'
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
  /** Rejects every row still queued with one error (the plan limit was reached). */
  abstract rejectQueued(
    tenantId: string,
    importId: string,
    error: { code: string; message: string },
  ): Promise<void>;
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
  abstract findByFileHash(
    tenantId: string,
    env: ExecutionEnvironment,
    companyId: string | null,
    fileHash: string,
  ): Promise<ImportRecord | null>;
  abstract delete(tenantId: string, id: string): Promise<void>;
}
