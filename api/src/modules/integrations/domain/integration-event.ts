export const MAX_EVENT_ATTEMPTS = 8;
export const EVENT_LEASE_MS = 2 * 60_000;
export const CLAIM_BATCH_SIZE = 20;

/** Exponential backoff capped at one hour, with ±20% jitter. `attempt` starts at 1. */
export function nextAttemptDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(2 ** attempt * 5000, 3_600_000);
  return Math.round(base * (0.8 + random() * 0.4));
}
