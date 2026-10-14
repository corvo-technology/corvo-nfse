import type { NewOutboxMessage, OutboxMessage } from './outbox-message';
export interface IOutboxRepository {
  oldestPendingAvailableAt(now: Date): Promise<Date | null>; // system scope
  insert(message: NewOutboxMessage): Promise<boolean>; // false = dedupe hit
  claimBatch(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<OutboxMessage[]>; // system scope
  complete(
    id: string,
    tenantId: string,
    at: Date,
    attempt: number,
  ): Promise<boolean>;
  release(
    id: string,
    tenantId: string,
    error: string,
    nextAvailableAt: Date,
    at: Date,
    attempt: number,
  ): Promise<boolean>;
  markDead(
    id: string,
    tenantId: string,
    error: string,
    at: Date,
    attempt: number,
  ): Promise<boolean>;
}
export const OUTBOX_REPOSITORY = 'OUTBOX_REPOSITORY';
