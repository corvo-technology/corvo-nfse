import type { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeDocument, NfeHistoryEntry } from './nfe-document';
import type { NfeStatus } from './nfe-status';

export interface ListNfeFilters {
  /** Only the documents of this model; every model when absent. */
  model?: 55 | 65;
  companyId?: string;
  status?: NfeStatus;
}

export abstract class INfeDocumentRepository {
  abstract insert(document: NfeDocument): Promise<void>;
  /** Writes the document row (items are immutable once inserted). */
  abstract save(document: NfeDocument): Promise<void>;
  /** A corrected resubmission: the stored items give way to the ones of the document. */
  abstract replaceItems(document: NfeDocument): Promise<void>;
  /** `forUpdate` locks the row until the surrounding transaction ends; it must run inside one. */
  abstract findById(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options?: { forUpdate?: boolean; model?: 55 | 65 },
  ): Promise<NfeDocument | null>;
  abstract findByIdempotencyKey(
    key: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeDocument | null>;
  abstract findByAccessKey(
    accessKey: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeDocument | null>;
  abstract list(
    tenantId: string,
    environment: ExecutionEnvironment,
    query: CursorQuery & ListNfeFilters,
  ): Promise<CursorPage<NfeDocument>>;
  abstract appendHistory(entry: NfeHistoryEntry): Promise<void>;
  abstract history(
    documentId: string,
    tenantId: string,
  ): Promise<Array<NfeHistoryEntry & { createdAt: Date }>>;
}
