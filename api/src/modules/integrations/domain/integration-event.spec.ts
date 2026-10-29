import { nextAttemptDelayMs } from './integration-event';

describe('nextAttemptDelayMs', () => {
  it('doubles per attempt, within ±20% jitter', () => {
    expect(nextAttemptDelayMs(1, () => 0.5)).toBe(10_000);
    expect(nextAttemptDelayMs(2, () => 0.5)).toBe(20_000);
    expect(nextAttemptDelayMs(3, () => 0)).toBe(32_000);
    expect(nextAttemptDelayMs(3, () => 1)).toBe(48_000);
  });
  it('caps the base at one hour', () => {
    expect(nextAttemptDelayMs(30, () => 0.5)).toBe(3_600_000);
    expect(nextAttemptDelayMs(30, () => 1)).toBe(4_320_000);
  });
});
