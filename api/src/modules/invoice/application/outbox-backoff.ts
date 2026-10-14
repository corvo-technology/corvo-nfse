export function outboxBackoffMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(attempts - 1, 0), 300_000);
}
