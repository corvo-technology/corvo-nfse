import { parseEnvConfig } from './env.schema';

describe('outbox environment configuration', () => {
  it('applies defaults', () => {
    const env = parseEnvConfig({ NODE_ENV: 'test' });
    expect(env.OUTBOX_RELAY_INTERVAL_MS).toBe(1000);
    expect(env.WEBHOOK_RETRY_INTERVAL_MS).toBe(10000);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_LEASE_MS).toBe(120000);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(10);
    expect(env.OUTBOX_SCHEDULE_MAX_DAYS).toBe(15);
  });

  it('coerces overrides and rejects non-positive values', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test', OUTBOX_BATCH_SIZE: '5' })
        .OUTBOX_BATCH_SIZE,
    ).toBe(5);
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', OUTBOX_MAX_ATTEMPTS: '0' }),
    ).toThrow();
  });
});
