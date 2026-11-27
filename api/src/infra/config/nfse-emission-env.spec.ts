import { parseEnvConfig } from './env.schema';

describe('nfse emission environment configuration', () => {
  it('sends three invoices at once by default', () => {
    expect(parseEnvConfig({ NODE_ENV: 'test' }).NFSE_EMISSION_CONCURRENCY).toBe(
      3,
    );
  });

  it('accepts an override between 1 and 10 and rejects anything else', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test', NFSE_EMISSION_CONCURRENCY: '5' })
        .NFSE_EMISSION_CONCURRENCY,
    ).toBe(5);
    for (const invalid of ['0', '11', 'abc'])
      expect(() =>
        parseEnvConfig({
          NODE_ENV: 'test',
          NFSE_EMISSION_CONCURRENCY: invalid,
        }),
      ).toThrow();
  });
});

describe('government rate limit configuration', () => {
  it('defaults to 5 per second, burst 10, 10 s of waiting and 50 recovered items', () => {
    const env = parseEnvConfig({ NODE_ENV: 'test' });
    expect(env.GOV_RATE_LIMIT_PER_SECOND).toBe(5);
    expect(env.GOV_RATE_LIMIT_BURST).toBe(10);
    expect(env.GOV_RATE_LIMIT_MAX_WAIT_MS).toBe(10_000);
    expect(env.DOCS_RECOVERY_MAX_PER_RUN).toBe(50);
  });

  it('accepts overrides and rejects a zero rate', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test', GOV_RATE_LIMIT_PER_SECOND: '2.5' })
        .GOV_RATE_LIMIT_PER_SECOND,
    ).toBe(2.5);
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', GOV_RATE_LIMIT_PER_SECOND: '0' }),
    ).toThrow();
  });
});
