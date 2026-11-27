export const OUTBOX_RETENTION = 'OUTBOX_RETENTION';

/** Purges finished outbox rows. `enabled` false is a dry run: it only counts and logs. */
export interface IOutboxRetention {
  purge(enabled: boolean, now: Date): Promise<void>;
}
