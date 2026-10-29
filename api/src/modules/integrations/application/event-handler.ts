import type { ClaimedEvent } from '../domain/integration-event.repository';

export interface EventOutcome {
  state: 'processed' | 'ignored' | 'needs_attention';
  operationId?: string;
  lastError?: string;
}

/** Turns a claimed event into an operation and, when eligible, an invoice. */
export abstract class EventHandler {
  /** A thrown error means "try again later". */
  abstract handle(event: ClaimedEvent): Promise<EventOutcome>;
}
