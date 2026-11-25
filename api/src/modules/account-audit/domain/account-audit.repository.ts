import type { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type {
  AccountAuditEventView,
  AuditActorRef,
  AuditEventFilters,
  NewAuditRow,
} from './account-audit';

export abstract class IAccountAuditRepository {
  abstract insert(row: NewAuditRow): Promise<void>;
  abstract listPage(
    tenantId: string,
    environment: ExecutionEnvironment,
    filters: AuditEventFilters,
    options: CursorQuery,
  ): Promise<CursorPage<AccountAuditEventView>>;
  abstract deleteOlderThan(tenantId: string, cutoff: Date): Promise<number>;
}

export type ResolvedActorLabel = { label: string; onBehalfOf: string | null };

/** Names the actor when the action happens; the label is stored and never changes afterwards. */
export abstract class AuditActorLabeler {
  abstract resolve(
    actor: AuditActorRef,
    tenantId: string,
  ): Promise<ResolvedActorLabel>;
}
