import type { OutboxMessage } from './outbox-message';

export interface OutboxHandler {
  readonly type: string;
  /** Must be idempotent: a message can be delivered again after a crash. */
  handle(message: OutboxMessage): Promise<void>;
}
