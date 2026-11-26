/** Delay before the next automatic reconciliation: 2, 4, 8, 16 min, then 30 min. */
export function reconciliationDelayMs(attempt: number): number {
  return Math.min(1800000, 60000 * 2 ** attempt);
}
