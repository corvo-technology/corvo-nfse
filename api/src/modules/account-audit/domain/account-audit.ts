import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { AccountAuditAction } from './account-audit-action';

export type AuditActorType = 'user' | 'agent' | 'api_key' | 'system';
export const AUDIT_ACTOR_TYPES: readonly AuditActorType[] = [
  'user',
  'agent',
  'api_key',
  'system',
];

export type AuditActorRef = {
  type: AuditActorType;
  id: string | null;
  onBehalfOfUserId?: string | null;
  ipHash?: string | null;
};

export const SYSTEM_ACTOR: AuditActorRef = { type: 'system', id: null };

export type AuditTargetType =
  | 'company'
  | 'certificate'
  | 'invoice'
  | 'import'
  | 'schedule'
  | 'payment'
  | 'plan'
  | 'member'
  | 'invitation'
  | 'api_key'
  | 'agent_connection'
  | 'accountant';

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AccountAuditInput {
  tenantId: string;
  /** null/omitted = account-level action (members, keys, billing). */
  environment?: ExecutionEnvironment | null;
  action: AccountAuditAction;
  target?: { type: AuditTargetType; id?: string | null; label?: string | null };
  /** Sanitized on write: primitives only, secret-looking keys dropped. */
  metadata?: Record<string, unknown>;
  /** Defaults to the request actor; outside a request, SYSTEM_ACTOR. */
  actor?: AuditActorRef;
}

/** Never throws: a failure to audit must not break the audited action. */
export abstract class AccountAuditRecorder {
  abstract record(input: AccountAuditInput): Promise<void>;
}

export interface AccountAuditEventView {
  id: string;
  occurredAt: string;
  environment: 'test' | 'live' | null;
  actor: { type: AuditActorType; label: string; onBehalfOf: string | null };
  action: AccountAuditAction;
  target: { type: string | null; id: string | null; label: string | null };
  metadata: AuditMetadata;
}

export type AuditEventFilters = {
  actorType?: AuditActorType;
  from?: Date;
  to?: Date;
};

export interface NewAuditRow {
  tenantId: string;
  environment: ExecutionEnvironment | null;
  action: AccountAuditAction;
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
  actorOnBehalfOfLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: AuditMetadata;
  ipHash: string | null;
}
