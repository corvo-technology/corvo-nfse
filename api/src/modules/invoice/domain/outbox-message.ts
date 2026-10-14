import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
export type OutboxStatus = 'pending' | 'claimed' | 'completed' | 'dead';
export interface OutboxMessage {
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  status: OutboxStatus;
  availableAt: Date;
  leaseUntil: Date | null;
  attempts: number;
  lastError: string | null;
}
export interface NewOutboxMessage {
  tenantId: string;
  environment: ExecutionEnvironment;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  availableAt?: Date;
}
