import { outboxBackoffMs } from './outbox-backoff';

describe('outboxBackoffMs', () => {
  it.each([
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [20, 300000],
  ])('attempt %i waits %i ms', (attempts, expected) =>
    expect(outboxBackoffMs(attempts)).toBe(expected),
  );
});
