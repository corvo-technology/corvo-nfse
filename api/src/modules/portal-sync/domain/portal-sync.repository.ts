import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** A company the portal can be read for: it has a certificate that can still sign. */
export interface SyncTarget {
  companyId: string;
  environment: ExecutionEnvironment;
}

export interface PortalSyncCursor {
  lastNsu: number;
  /** Null until the first read of the company reached the end of the portal's history. */
  firstRoundDoneAt: Date | null;
  nextRunAt: Date;
  idleRuns: number;
  failures: number;
}

export type PortalSyncCursorUpdate = Partial<
  PortalSyncCursor & { lastRunAt: Date; lastError: string | null }
>;

export interface NewPortalDocument {
  nsu: number;
  accessKey: string;
  documentType: string;
  eventType: string | null;
  xml: string;
  generatedAt: Date;
}

export interface StoredPortalDocument extends NewPortalDocument {
  id: string;
  attempts: number;
}

/** Everything is scoped by workspace; the isolation also holds in the database (row level security). */
export abstract class IPortalSyncRepository {
  /** Companies of the workspace with an active, unexpired certificate. */
  abstract listTargets(tenantId: string): Promise<SyncTarget[]>;
  abstract findCursor(
    tenantId: string,
    target: SyncTarget,
  ): Promise<PortalSyncCursor | null>;
  /** Creates the cursor at NSU 0, first due at `nextRunAt`; keeps an existing one. */
  abstract createCursor(
    tenantId: string,
    target: SyncTarget,
    nextRunAt: Date,
  ): Promise<void>;
  abstract updateCursor(
    tenantId: string,
    target: SyncTarget,
    update: PortalSyncCursorUpdate,
  ): Promise<void>;
  /** Writing the same NSU again changes nothing. */
  abstract saveDocument(
    tenantId: string,
    target: SyncTarget,
    document: NewPortalDocument,
  ): Promise<void>;
  /** Documents not processed yet, oldest NSU first, that were not given up on. */
  abstract listUnprocessed(
    tenantId: string,
    target: SyncTarget,
    maxAttempts: number,
    limit: number,
  ): Promise<StoredPortalDocument[]>;
  abstract markProcessed(tenantId: string, documentId: string): Promise<void>;
  abstract markFailed(
    tenantId: string,
    documentId: string,
    error: string,
  ): Promise<void>;
}
