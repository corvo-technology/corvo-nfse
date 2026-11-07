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
