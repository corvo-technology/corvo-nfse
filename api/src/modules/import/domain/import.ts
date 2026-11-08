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
  /** Rows the file turned out to have, known once it was parsed: lets the screen show reading progress. */
  rowsExpected: number | null;
  /** Header names of the file that matched no column: they were ignored. */
  unknownColumns: string[];
  emitStartedAt: Date | null;
  emitFinishedAt: Date | null;
  createdAt: Date;
};

export type NewImport = Omit<
  ImportRecord,
  | 'status'
  | 'errorCode'
  | 'unknownColumns'
  | 'rowsExpected'
  | 'emitStartedAt'
  | 'emitFinishedAt'
  | 'createdAt'
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
  /** Turned away because credits or the plan limit ran out: not an error, it can be emitted again. */
  awaitingCredits: number;
  /** Sum, in reais, of the rows ready to emit. */
  validAmount: number;
  /** Sum, in reais, of the rows waiting for credits. */
  awaitingAmount: number;
  failed: number;
  /** Rows not final yet: waiting to be emitted, or accepted and still being processed. */
  pending: number;
  /** Sum, in reais, of the invoices the city already authorized. */
  authorizedAmount: number;
  /** Sum, in reais, of the rows not final yet (the same rows as `pending`). */
  pendingAmount: number;
  /**
   * Sum, in reais, of the rows sent that ended in error. Rows that failed the check
   * before emitting (`invalid`) are left out: their amount may not even be a number.
   */
  failedAmount: number;
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

/** Rejections that go away by topping up credits (or trying again): those rows are "awaiting credits", not errors. */
export const LIMIT_CODES = [
  'ERROR_PLAN_BLOCKED',
  'ERROR_MONTHLY_LIMIT_EXCEEDED',
  'ERROR_DAILY_LIMIT_EXCEEDED',
  'ERROR_INSUFFICIENT_CREDITS',
  'ERROR_QUOTA_EXCEEDED',
  // The job gave up after every attempt: nothing wrong with the row itself.
  'ERROR_IMPORT_EMIT_FAILED',
];
