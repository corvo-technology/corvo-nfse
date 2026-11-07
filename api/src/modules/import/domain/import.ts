import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export type ImportStatus =
  | 'processing'
  | 'ready'
  | 'emitting'
  | 'done'
  | 'failed';

export type ImportRowStatus =
  | 'valid'
  | 'invalid'
  | 'queued'
  | 'accepted'
  | 'rejected';

export type ImportRecord = {
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  userId: string;
  fileName: string;
  fileHash: string;
  status: ImportStatus;
  companyId: string | null;
  errorCode: string | null;
  emitStartedAt: Date | null;
  emitFinishedAt: Date | null;
  createdAt: Date;
};

export type NewImport = Omit<
  ImportRecord,
  'status' | 'errorCode' | 'emitStartedAt' | 'emitFinishedAt' | 'createdAt'
>;

export type ImportRow = {
  line: number;
  data: Record<string, unknown>;
  status: ImportRowStatus;
  errorCode: string | null;
  errorMessage: string | null;
  invoiceId: string | null;
};

export type ImportCounters = {
  total: number;
  valid: number;
  invalid: number;
  accepted: number;
  authorized: number;
  failed: number;
  /** Rows not final yet: waiting to be emitted, or accepted and still being processed. */
  pending: number;
};

export type RowPageQuery = {
  status?: ImportRowStatus;
  cursor?: string;
  limit: number;
};

export type RowPage = { items: ImportRow[]; nextCursor: string | null };

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS_PAGE = 200;
export const DEFAULT_ROWS_PAGE = 50;
